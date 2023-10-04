import express from "express";
const app = express();
import config from "./config.js";
import CaptureTime from "./models/captureTime.js";
import axios from "axios";
import schedule from "node-schedule";
import Redis from "ioredis";
const redis = new Redis();

async function setAlaram(resJson) {
  // 스케줄러 호출
  const { memberId, roomId, coreTimeId, token } = resJson;
  console.log(coreTimeId, new Date());
  const coreTimes = await CaptureTime.find()
    .where("coreTimeId")
    .equals(coreTimeId);

  let alarmTimes = [];
  for (let coreTime of coreTimes) {
    alarmTimes.push(coreTime.captureTime);
  }

  alarmTimes.forEach((time) => {
    const targetDateTime = new Date(time);
    console.log(targetDateTime);

    const rule = new schedule.RecurrenceRule();
    rule.year = targetDateTime.getFullYear();
    rule.month = targetDateTime.getMonth();
    rule.date = targetDateTime.getDate();
    rule.hour = targetDateTime.getHours();
    rule.minute = targetDateTime.getMinutes();
    rule.second = targetDateTime.getSeconds();

    let job = schedule.scheduleJob(
      memberId.toString(),
      rule,
      sendMessage.bind(null, { token, coreTimeId, roomId })
    );

    redis.set(memberId, job).then(() => {
      console.log(`${memberId} 님의 스케줄링 객체가 Redis에 저장되었습니다.`);
    });
  });
}

async function sendMessage(resJson) {
  let { token, coreTimeId, roomId } = resJson;
  console.log(`알림: ${new Date()}에 알림을 보냅니다.\n`);
  console.log(
    "sendMessage 호출 + coreTimeId=",
    coreTimeId,
    "/token=",
    token,
    "/roomId=",
    roomId
  );
  const requestUrl = "https://fcm.googleapis.com/fcm/send";
  const headers = {
    "Content-Type": "application/json",
    Authorization: config.serverKey,
  };
  let message = {
    data: {},
    notification: {
      title: "[learniverse] randomCapture",
      body: "현재 코딩중인 화면을 공유해주세요",
    },
    to: token,
    webpush: {
      fcm_options: {
        link: `https://learniverse-front-end.vercel.app/coretime/${roomId}?room_id=${coreTimeId}`,
      },
    },
  };
  try {
    const response = await axios.post(requestUrl, message, { headers });

    console.log("응답 데이터:", response.data);
  } catch (error) {
    // 오류가 발생했을 때의 처리
    console.error("POST 요청 중 오류 발생:", error);
  }
}

export { setAlaram, sendMessage };
