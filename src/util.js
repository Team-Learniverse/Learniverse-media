import express from "express";
const app = express();
import config from "./config.js";
import CaptureTime from "./models/captureTime.js";
import ValidMember from "./models/validMember.js";
import axios from "axios";
import schedule from "node-schedule";

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

  const isMemberExist = await ValidMember.findOne()
    .where("memberId")
    .equals(memberId);
  if (isMemberExist) {
    const result = await ValidMember.updateOne(
      { memberId: memberId },
      { isValid: true }
    );
    console.log(`${memberId} 의 알람 켜짐 isValid = ${result[0].isValid}`);
  } else {
    const memberInfo = new ValidMember({ memberId, isValid: true });
    const saveMember = await memberInfo.save();
    console.log(`savedMember : ${saveMember}`);
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

    schedule.scheduleJob(
      memberId.toString(),
      rule,
      sendMessage.bind(null, {
        token,
        coreTimeId,
        roomId,
        memberId,
      })
    );
  });
  return alarmTimes;
}

async function sendMessage(resJson) {
  let { token, coreTimeId, roomId, memberId } = resJson;
  const memberInfo = await ValidMember.find()
    .where("memberId")
    .equals(memberId);

  if (!memberInfo[0].isValid) {
    console.log(`${memberId}는 유효하지 않은 사용자입니다.`);
    return;
  } else {
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
}

export { setAlaram, sendMessage };
