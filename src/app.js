import express from "express";
const app = express();
import http from "http";
import fs from "fs";
import mediasoup from "mediasoup";
import config from "./config.js";
import Room from "./Room.js";
import Peer from "./Peer.js";
import Server from "socket.io";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import cors from "cors";

const createPresignedUrlWithClient = ({ region, bucket, key }) => {
  const { s3AccessKeyId, s3SecretAccessKey, s3BucketName, fileName } = config;

  const client = new S3Client({
    region: region,
    credentials: {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
    },
  });

  const command = new PutObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn: 3600 });
};

const options = {
  key: fs.readFileSync("ssl/key.pem"),
  cert: fs.readFileSync("ssl/cert.pem"),
};

const httpsServer = http.createServer(app);
app.use(
  cors({
    origin: "*", // 클라이언트의 주소로 대체하세요
    methods: ["GET", "POST"],
    credentials: true, // 인증 정보를 허용하려면 true로 설정
  })
);
app.get("/test", (req, res) => {
  res.send("ok");
});
app.get("/presigned-url", async (req, res) => {
  const { s3SecretAccessKey, s3BucketName } = config;
  const clientUrl = await createPresignedUrlWithClient({
    region: "us-east-2",
    bucket: s3BucketName,
    key: s3SecretAccessKey,
  });

  res.send(clientUrl);
});

httpsServer.listen(8080, () => {
  console.log(
    "✅ Listening on https://" + config.listenIp + ":" + config.listenPort
  );
});
// all mediasoup workers
let workers = [];
let nextMediasoupWorkerIdx = 0;

let roomList = new Map();

(async () => {
  await createWorkers();
})();

async function createWorkers() {
  let { numWorkers } = config.mediasoup;

  for (let i = 0; i < numWorkers; i++) {
    let worker = await mediasoup.createWorker({
      logLevel: config.mediasoup.worker.logLevel,
      logTags: config.mediasoup.worker.logTags,
      rtcMinPort: config.mediasoup.worker.rtcMinPort,
      rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
    });

    worker.on("died", () => {
      console.error(
        "mediasoup worker died, exiting in 2 seconds... [pid:%d]",
        worker.pid
      );
      setTimeout(() => process.exit(1), 2000);
    });
    workers.push(worker);
  }
}

const io = new Server(httpsServer, {
  serveClient: false,
  path: "/server",
  log: false,
});
io.origins("*:*");
io.on("connect", (socket) => {
  console.log(`클라이언트 연결 성공 - 소켓ID: ${socket.id}`);

  socket.on("createRoom", async ({ room_id }, callback) => {
    if (roomList.has(room_id)) {
      callback("already exists");
    } else {
      console.log("Created room", { room_id: room_id });
      let worker = await getMediasoupWorker();
      roomList.set(room_id, new Room(room_id, worker, io));
      callback(room_id);
    }
  });

  socket.on("join", ({ room_id, name }, cb) => {
    console.log("User joined", {
      room_id: room_id,
      name: name,
    });

    if (!roomList.has(room_id)) {
      return cb({
        error: "Room does not exist",
      });
    }

    roomList.get(room_id).addPeer(new Peer(socket.id, name));
    socket.room_id = room_id;
    socket.name = name;

    cb(roomList.get(room_id).toJson());
  });

  socket.on("getProducers", () => {
    if (!roomList.has(socket.room_id)) return;
    console.log("Get producers", {
      name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
    });

    // send all the current producer to newly joined member
    let producerList = roomList.get(socket.room_id).getProducerListForPeer();

    socket.emit("newProducers", producerList);
  });

  socket.on("getOriginProducers", () => {
    if (!roomList.has(socket.room_id)) return;
    console.log("Get producers", {
      name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
    });

    // send all the current producer to newly joined member
    let producerList = roomList.get(socket.room_id).getProducerListForPeer();
    socket.emit("existedProducers", producerList);
  });

  //채팅
  socket.on("message", (data) => {
    if (!roomList.has(socket.room_id)) return;
    console.log("chatting", data);
    const today = new Date();
    data = {
      name: socket.name,
      message: data,
      time: today.toLocaleTimeString("kr", { hour12: false }).slice(0, -3),
    };
    roomList.get(socket.room_id).broadCast(socket.id, "message", data);
  });

  socket.on("getRouterRtpCapabilities", (_, callback) => {
    console.log("Get RouterRtpCapabilities", {
      name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
    });

    try {
      callback(roomList.get(socket.room_id).getRtpCapabilities());
    } catch (e) {
      callback({
        error: e.message,
      });
    }
  });

  socket.on("createWebRtcTransport", async (_, callback) => {
    console.log("Create webrtc transport", {
      name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
    });

    try {
      const { params } = await roomList
        .get(socket.room_id)
        .createWebRtcTransport(socket.id);

      callback(params);
    } catch (err) {
      console.error(err);
      callback({
        error: err.message,
      });
    }
  });

  socket.on(
    "connectTransport",
    async ({ transport_id, dtlsParameters }, callback) => {
      console.log("Connect transport", {
        name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
      });

      if (!roomList.has(socket.room_id)) return;
      await roomList
        .get(socket.room_id)
        .connectPeerTransport(socket.id, transport_id, dtlsParameters);

      callback("success");
    }
  );

  socket.on(
    "produce",
    async ({ kind, rtpParameters, producerTransportId }, callback) => {
      if (!roomList.has(socket.room_id)) {
        return callback({ error: "not is a room" });
      }

      let producer_id = await roomList
        .get(socket.room_id)
        .produce(socket.id, producerTransportId, rtpParameters, kind);

      console.log("Produce", {
        type: `${kind}`,
        name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
        id: `${producer_id}`,
      });

      callback({
        producer_id,
      });
    }
  );

  socket.on(
    "consume",
    async ({ consumerTransportId, producerId, rtpCapabilities }, callback) => {
      //TODO null handling
      let params = await roomList
        .get(socket.room_id)
        .consume(socket.id, consumerTransportId, producerId, rtpCapabilities);

      console.log("Consuming", {
        name: `${
          roomList.get(socket.room_id) &&
          roomList.get(socket.room_id).getPeers().get(socket.id).name
        }`,
        producer_id: `${producerId}`,
        consumer_id: `${params.id}`,
      });

      callback(params);
    }
  );

  socket.on("resume", async (data, callback) => {
    await consumer.resume();
    callback();
  });

  socket.on("getMyRoomInfo", (_, cb) => {
    cb(roomList.get(socket.room_id).toJson());
  });

  socket.on("disconnect", () => {
    console.log("Disconnect", {
      name: `${
        roomList.get(socket.room_id) &&
        roomList.get(socket.room_id).getPeers().get(socket.id).name
      }`,
    });

    if (!socket.room_id) return;
    roomList.get(socket.room_id).removePeer(socket.id);
  });

  socket.on("producerClosed", ({ producer_id }) => {
    console.log("Producer close", {
      name: `${
        roomList.get(socket.room_id) &&
        roomList.get(socket.room_id).getPeers().get(socket.id).name
      }`,
    });

    roomList.get(socket.room_id).closeProducer(socket.id, producer_id);
  });

  socket.on("exitRoom", async (_, callback) => {
    console.log("Exit room", {
      name: `${
        roomList.get(socket.room_id) &&
        roomList.get(socket.room_id).getPeers().get(socket.id).name
      }`,
    });

    if (!roomList.has(socket.room_id)) {
      callback({
        error: "not currently in a room",
      });
      return;
    }
    // close transports
    await roomList.get(socket.room_id).removePeer(socket.id);
    if (roomList.get(socket.room_id).getPeers().size === 0) {
      roomList.delete(socket.room_id);
    }

    socket.room_id = null;

    callback("successfully exited room");
  });
});

/**
 * Get next mediasoup Worker.
 */
function getMediasoupWorker() {
  const worker = workers[nextMediasoupWorkerIdx];

  if (++nextMediasoupWorkerIdx === workers.length) nextMediasoupWorkerIdx = 0;

  return worker;
}
