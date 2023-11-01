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
import ValidMember from "./models/validMember.js";
import ActiveMember from "./models/activeMember.js";

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
app.get("/getCaptureTime", S3Controller.getCaptureTime);
app.get("/getKorTime", (req, res) => {
  const curr = new Date();
  console.log("현재시간(Locale) : " + curr + "<br>");
  const utc = curr.getTime() + curr.getTimezoneOffset() * 60 * 1000;
  const KR_TIME_DIFF = 9 * 60 * 60 * 1000;
  const today = new Date(utc + KR_TIME_DIFF);
  const time = today.toLocaleTimeString("kr", { hour12: false }).slice(0, -3);

  console.log("한국시간 : " + time);
  res.send(time);
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

  socket.on("createRoom", async ({ coreTimeId }, callback) => {
    if (roomList.has(coreTimeId)) {
      callback("already exists");
    } else {
      console.log("Created room", { room_id: coreTimeId });
      let worker = await getMediasoupWorker();
      roomList.set(coreTimeId, new Room(coreTimeId, worker, io));
      callback(coreTimeId);
    }
  });

  socket.on("join", async ({ coreTimeId, memberId }, callback) => {
    console.log("User joined", {
      room_id: coreTimeId,
      memberId: memberId,
    });

    //조인할때 보내기
    utilService.sendMoonRequest(memberId);

    if (!roomList.has(coreTimeId)) {
      return callback({
        error: "Room does not exist",
      });
    }

    //현재 이미 active한 멤버인지 조회
    const isExistedMember = await ActiveMember.findOne()
      .where("memberId")
      .equals(memberId);
    console.log(isExistedMember);

    if (isExistedMember) {
      console.log(`${memberId} 이미 다른 코어타임에 존재함`);
      console.log(isExistedMember);
      callback({ error: `${memberId} 이미 다른 코어타임에 존재함` });
    } else {
      const memberInfo = new ActiveMember({ memberId, coreTimeId });
      await memberInfo.save();
      console.log(`${memberId} 코어타입 입장/ 코어타임 id: ${coreTimeId}`);
    }

    //그냥 룸id
    roomList.get(coreTimeId).addPeer(new Peer(socket.id, memberId));
    socket.coreTimeId = coreTimeId;
    socket.memberId = memberId;

    const resJson = {
      coreTimeId: coreTimeId,
      peers: roomList.get(socket.coreTimeId).getPeers().values(),
    };
    callback(resJson);
  });

  socket.on("getProducers", () => {
    if (!roomList.has(socket.coreTimeId)) return;
    console.log("Get producers", {
      name: `${
        roomList.get(socket.coreTimeId).getPeers().get(socket.id).memberId
      }`,
    });
    let producerList = roomList.get(socket.coreTimeId).getProducerListForPeer();

    console.log("newProducers", producerList);
    socket.emit("newProducers", producerList);
  });

  socket.on("getRoomInfo", (_, callback) => {
    if (!roomList.has(socket.coreTimeId)) return;
    let producerList = [];
    const peers = roomList.get(socket.coreTimeId).getPeers();

    peers.forEach((peer) => {
      peer.producers.forEach((producer) => {
        const producerInfo = peer.produceTypes.get(producer.id);

        producerList.push({
          producer_id: producer.id,
          producer_type: producerInfo.type,
          socketId: producerInfo.id,
          memberId: producerInfo.memberId,
        });
      });
    });

    const resJson = {
      coreTimeId: socket.coreTimeId,
      peers: producerList,
      peerCount: roomList.get(socket.coreTimeId).peers.size,
    };
    console.log("getRoomInfo", resJson);
    callback(resJson);
  });

  socket.on("getRoomPeerInfo", (_, callback) => {
    if (!roomList.has(socket.coreTimeId)) return;
    let peerList = [];
    const peers = roomList.get(socket.coreTimeId).getPeers();

    peers.forEach((peer) => {
      peerList.push({
        socketId: peer.id,
        memberId: peer.memberId,
      });
    });

    console.log("getRoomPeerInfo", peerList);
    callback(peerList);
  });

  socket.on("getOriginProducers", () => {
    if (!roomList.has(socket.coreTimeId)) return;
    console.log("Get producers", {
      name: `${
        roomList.get(socket.coreTimeId).getPeers().get(socket.id).memberId
      }`,
    });

    // send all the current producer to newly joined member
    let producerList = roomList.get(socket.coreTimeId).getProducerListForPeer();
    socket.emit("existedProducers", producerList);
  });

  //채팅
  socket.on("message", (data) => {
    if (!roomList.has(socket.coreTimeId)) return;
    console.log("chatting", data);
    const curr = new Date();

    const utc = curr.getTime() + curr.getTimezoneOffset() * 60 * 1000;
    const KR_TIME_DIFF = 9 * 60 * 60 * 1000;
    const today = new Date(utc + KR_TIME_DIFF);
    const time = today.toLocaleTimeString("kr", { hour12: false }).slice(0, -3);
    console.log("현재시간(Locale) : " + time + "<br>");

    data = {
      memberId: socket.memberId,
      message: data,
      time: time,
    };
    roomList.get(socket.coreTimeId).broadCast(socket.id, "message", data);
  });

  socket.on("getRouterRtpCapabilities", (_, callback) => {
    console.log("Get RouterRtpCapabilities", {
      name: `${
        roomList.get(socket.coreTimeId).getPeers().get(socket.id).memberId
      }`,
    });

    try {
      callback(roomList.get(socket.coreTimeId).getRtpCapabilities());
    } catch (e) {
      callback({
        error: e.message,
      });
    }
  });

  socket.on("createWebRtcTransport", async (_, callback) => {
    console.log("Create webrtc transport", {
      name: `${
        roomList.get(socket.coreTimeId).getPeers().get(socket.id).memberId
      }`,
    });

    try {
      const { params } = await roomList
        .get(socket.coreTimeId)
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
        name: `${
          roomList.get(socket.coreTimeId).getPeers().get(socket.id).memberId
        }`,
      });

      if (!roomList.has(socket.coreTimeId)) return;
      await roomList
        .get(socket.coreTimeId)
        .connectPeerTransport(socket.id, transport_id, dtlsParameters);

      callback("success");
    }
  );

  socket.on(
    "produce",
    async ({ kind, rtpParameters, producerTransportId }, callback) => {
      if (!roomList.has(socket.coreTimeId)) {
        return callback({ error: "not is a room" });
      }

      let producer_id = await roomList
        .get(socket.coreTimeId)
        .produce(
          socket.id,
          socket.memberId,
          producerTransportId,
          rtpParameters,
          kind
        );

      console.log("Produce", {
        type: `${kind}`,
        name: `${
          roomList.get(socket.coreTimeId).getPeers().get(socket.id).memberId
        }`,
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
      //TODO null handfg
      let params = await roomList
        .get(socket.coreTimeId)
        .consume(
          socket.id,
          consumerTransportId,
          producerId,
          producerName,
          rtpCapabilities
        );

      console.log("Consuming", {
        name: `${
          roomList.get(socket.coreTimeId) &&
          roomList.get(socket.coreTimeId).getPeers().get(socket.id).memberId
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

  socket.on("disconnect", async () => {
    if (!socket.coreTimeId) return;

    console.log("Disconnect", {
      name: `${
        roomList.get(socket.coreTimeId) &&
        roomList.get(socket.coreTimeId).getPeers().get(socket.id).memberId
      }`,
    });

    //remove Alarm
    const memberId = roomList
      .get(socket.coreTimeId)
      .getPeers()
      .get(socket.id).memberId;
    var list = schedule.scheduledJobs;

    const memberJob = list[memberId.toString()];
    const status = schedule.cancelJob(memberJob);
    const resultMsg = `${memberId} job의 삭제여부 = ${status}`;
    await ValidMember.updateOne({ memberId: memberId }, { isValid: false });
    const result = await ValidMember.find().where("memberId").equals(memberId);
    console.log(resultMsg);
    console.log(`${memberId}의 현재 메시지 수신여부 ${result}`);

    //active에서 제외
    const isExistedMember = await ActiveMember.findOne()
      .where("memberId")
      .equals(memberId);
    if (isExistedMember) {
      const memberInfo = await ActiveMember.remove({ memberId: memberId });
      await memberInfo.save();
      console.log(`${memberId} activeList에서 삭제`);
    }

    roomList.get(socket.coreTimeId).removePeer(socket.id);
    roomList.get(socket.coreTimeId).broadCast(socket.id, "removeMember", {
      coreTimeId: socket.coreTimeId,
      memberId: socket.memberId,
    });
  });

  socket.on("producerClosed", ({ producer_id }) => {
    console.log("Producer close", {
      name: `${
        roomList.get(socket.coreTimeId) &&
        roomList.get(socket.coreTimeId).getPeers().get(socket.id).memberId
      }`,
    });

    roomList.get(socket.coreTimeId).closeProducer(socket.id, producer_id);
  });

  socket.on("exitRoom", async (_, callback) => {
    console.log("Exit room", {
      name: `${
        roomList.get(socket.coreTimeId) &&
        roomList.get(socket.coreTimeId).getPeers().get(socket.id).memberId
      }`,
    });
    const name = roomList
      .get(socket.coreTimeId)
      .getPeers()
      .get(socket.id).memberId;

    //active에서 제외
    const isExistedMember = await ActiveMember.findOne()
      .where("memberId")
      .equals(name);
    if (isExistedMember) {
      const memberInfo = await ActiveMember.remove({ memberId: name });
      await memberInfo.save();
      console.log(`${name} activeList에서 삭제`);
    }

    //exit message 보내주기 && 멤버 상태 업데이트
    await ValidMember.updateOne({ memberId: name }, { isValid: false });
    const memberId = roomList
      .get(socket.coreTimeId)
      .getPeers()
      .get(socket.id).memberId;
    const result = await ValidMember.find().where("memberId").equals(memberId);
    console.log(`${memberId}의 현재 메시지 수신여부 ${result}`);

    roomList.get(socket.coreTimeId).broadCast(socket.id, "removeMember", {
      coreTimeId: socket.coreTimeId,
      memberId: socket.memberId,
    });

    if (!roomList.has(socket.coreTimeId)) {
      callback({
        error: "not currently in a room",
      });
      return;
    }
    // close transports
    await roomList.get(socket.coreTimeId).removePeer(socket.id);
    if (roomList.get(socket.coreTimeId).getPeers().size === 0) {
      roomList.delete(socket.coreTimeId);
    }
    socket.coreTimeId = null;
    callback("successfully exited room");
  });

  socket.on("setVideoOff", (_, callback) => {
    if (!roomList.has(socket.coreTimeId)) return;
    const data = { coreTimeId: socket.coreTimeId, memberId: socket.memberId };
    console.log("Video off", socket.memberId);
    roomList.get(socket.coreTimeId).broadCast(socket.id, "setVideoOff", data);
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
    console.log("removeCaptureAlert");
    var list = schedule.scheduledJobs;
    const memberJob = list[memberId.toString()];
    const status = schedule.cancelJob(memberJob);
    const resultMsg = `${memberId} job의 삭제여부 = ${status}`;
    await ValidMember.updateOne({ memberId: memberId }, { isValid: false });
    const result = ValidMember.find().where("memberId").equals(memberId);

    console.log(result);
    console.log(`${memberId}의 현재 메시지 수신여부 `);

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
