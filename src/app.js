import express from "express";
const app = express();
import https from "httpolyglot";
import fs from "fs";
import mediasoup from "mediasoup";
import config from "./config.js";
import Room from "./Room.js";
import Peer from "./Peer.js";
import Server from "socket.io";
import cors from "cors";
import S3Controller from "./S3Controller.js";
import mongoose from "mongoose";
import bodyParser from "body-parser";
import * as utilService from "./util.js";
import schedule from "node-schedule";
import cricularJson from "circular-json";
import ValidMember from "./models/validMember.js";

const options = {
  key: fs.readFileSync("ssl/key.pem"),
  cert: fs.readFileSync("ssl/cert.pem"),
};
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
const httpsServer = https.createServer(options, app);

app.get("/test", S3Controller.testFunc);
app.get("/presigned-url", S3Controller.getUploadPresigned);
app.post("/createCapture", S3Controller.createCaptureInfo);
app.get("/getCapture", S3Controller.getCaptures);
app.post("/createCaptureTime", S3Controller.createCaptureTime);
app.get("/tqtq", async (req, res) => {
  var list = schedule.scheduledJobs;
  const resJson = cricularJson.stringify(list);
  res.send(resJson);
});
app.get("/removeJob", async (req, res) => {
  const { memberId } = req.query;
  var list = schedule.scheduledJobs;
  const resJson = cricularJson.stringify(list);

  const job = list[memberId.toString()]; // returns Job object corresponding to job with name 'hello123'
  console.log(job);
  const status = schedule.cancelJob(job);
  console.log(status);
  const updateResult = await ValidMember.updateOne(
    { memberId: memberId },
    { isValid: false }
  );
  console.log(updateResult);
  res.send(resJson);
});

app.post("/testCore", async (req, res) => {
  //여기서 메시지 보내줄 거임 나중에 socket으로 옮길거
  const { memberId, roomId, coreTimeId, token } = req.body;
  const coreTimes = await utilService.setAlaram(req.body);
  res.send("ok");
});
app.get("/getCaptureTime", S3Controller.getCaptureTime);
app.get("/getKorTime", (req, res) => {
  const curr = new Date();
  console.log("현재시간(Locale) : " + curr + "<br>");
  const utc = curr.getTime() + curr.getTimezoneOffset() * 60 * 1000;
  const KR_TIME_DIFF = 9 * 60 * 60 * 1000;
  const kr_curr = new Date(utc + KR_TIME_DIFF);

  console.log("한국시간 : " + kr_curr);
  res.send(kr_curr);
});
app.get("/getServerTime", (req, res) => {
  const curr = new Date();
  res.send(curr);
});
httpsServer.listen(config.listenPort, () => {
  mongoose.set("strictQuery", false);
  mongoose.connect("mongodb://127.0.0.1:27017/learniverse", function (err, db) {
    if (err) console.log(err);
    else {
      console.log(`✅ db successfully connected  > ${db}`);
    }
  });
  console.log(
    "✅ server listening on https://" +
      config.listenIp +
      ":" +
      config.listenPort
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
  log: false,
});

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

  socket.on("join", ({ room_id, name }, callback) => {
    console.log("User joined", {
      room_id: room_id,
      name: name,
    });

    if (!roomList.has(room_id)) {
      return callback({
        error: "Room does not exist",
      });
    }

    roomList.get(room_id).addPeer(new Peer(socket.id, name));
    socket.room_id = room_id;
    socket.name = name;

    const resJson = {
      room_id: room_id,
      peers: roomList.get(socket.room_id).getPeers().values(),
    };
    callback(resJson);
  });

  socket.on("getProducers", () => {
    if (!roomList.has(socket.room_id)) return;
    console.log("Get producers", {
      name: `${roomList.get(socket.room_id).getPeers().get(socket.id).name}`,
    });
    let producerList = roomList.get(socket.room_id).getProducerListForPeer();

    console.log("newProducers", producerList);
    socket.emit("newProducers", producerList);
  });

  socket.on("getRoomInfo", (_, callback) => {
    if (!roomList.has(socket.room_id)) return;
    let producerList = [];
    const peers = roomList.get(socket.room_id).getPeers();

    peers.forEach((peer) => {
      peer.producers.forEach((producer) => {
        const producerInfo = peer.produceTypes.get(producer.id);

        producerList.push({
          producer_id: producer.id,
          producer_type: producerInfo.type,
          producer_user_id: producerInfo.id,
          producer_user_name: producerInfo.name,
        });
      });
    });

    const resJson = {
      room_id: socket.room_id,
      peers: producerList,
      peerCount: roomList.get(socket.room_id).peers.size,
    };
    console.log("getRoomInfo", resJson);
    callback(resJson);
  });

  socket.on("getRoomPeerInfo", (_, callback) => {
    if (!roomList.has(socket.room_id)) return;
    let peerList = [];
    const peers = roomList.get(socket.room_id).getPeers();

    peers.forEach((peer) => {
      peerList.push({
        id: peer.id,
        name: peer.name,
      });
    });

    console.log("getRoomPeerInfo", peerList);
    callback(peerList);
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
        .produce(
          socket.id,
          socket.name,
          producerTransportId,
          rtpParameters,
          kind
        );

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
    async (
      { consumerTransportId, producerId, producerName, rtpCapabilities },
      callback
    ) => {
      //TODO null handling
      let params = await roomList
        .get(socket.room_id)
        .consume(
          socket.id,
          consumerTransportId,
          producerId,
          producerName,
          rtpCapabilities
        );

      console.log("Consuming", {
        name: `${
          roomList.get(socket.room_id) &&
          roomList.get(socket.room_id).getPeers().get(socket.id).name
        }`,
        producer_id: `${producerId}`,
        // consumer_id: `${params.id}`,
      });

      callback(params);
    }
  );

  socket.on("resume", async (data, callback) => {
    await consumer.resume();
    callback("resume ok");
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
    roomList.get(socket.room_id).broadCast(socket.id, "removeMember", {
      room_id: socket.room_id,
      name: socket.name,
    });
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
    const name =roomList.get(socket.room_id).getPeers().get(socket.id).name

    //exit message 보내주기
    const updateResult = await ValidMember.updateOne(
      { memberId: name },
      { isValid: false }
    );
    console.log(updateResult);

    roomList.get(socket.room_id).broadCast(socket.id, "removeMember", {
      room_id: socket.room_id,
      name: socket.name,
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

  socket.on("setVideoOff", (_, callback) => {
    if (!roomList.has(socket.room_id)) return;
    const data = { room_id: socket.room_id, name: socket.name };
    console.log("Video off", socket.name);
    roomList.get(socket.room_id).broadCast(socket.id, "setVideoOff", data);
  });

  socket.on(
    "setCaptureAlert",
    async ({ memberId, roomId, coreTimeId, token }, callback) => {
      const params = { memberId, roomId, coreTimeId, token };
      console.log("코어타임 생성", params);
      const coreTimes = await utilService.setAlaram(params);
      callback(coreTimes);
    }
  );

  socket.on("removeCaptureAlert", async ({ memberId }, callback) => {
    var list = schedule.scheduledJobs;
    const memberJob = list[memberId];
    const status = schedule.cancelJob(memberJob);
    const resultMsg = `${memberId} job의 삭제여부 = ${status}`;
    const updateResult = await ValidMember.updateOne(
      { memberId: memberId },
      { isValid: false }
    );
    console.log(updateResult);
    console.log(resultMsg);
    callback(resultMsg);
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
