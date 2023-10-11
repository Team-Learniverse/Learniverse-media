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
  console.log(isMemberExist);
  if (isMemberExist) {
    await ValidMember.updateOne({ memberId: memberId }, { isValid: true });
    console.log(`${memberId} 의 알람 켜짐 isValid =true`);
  } else {
    const memberInfo = new ValidMember({ memberId, isValid: true });
    const saveMember = await memberInfo.save();
    console.log(
      `${memberId} 의 알람 켜짐 isValid =true /savedMember : ${saveMember}`
    );
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
      data: {
        title: "[learniverse] randomCapture",
        body: "현재 코딩중인 화면을 공유해주세요",
        link: `https://learniverse-front-end.vercel.app/coretime/${roomId}?coreTimeId=${coreTimeId}`,
      },
      to: token,
      webpush: {
        fcm_options: {
          link: `https://learniverse-front-end.vercel.app/coretime/${roomId}?coreTimeId=${coreTimeId}`,
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

async function sendMoonRequest(memberId) {
  const requestUrl = "https://learniverse-main.kro.kr/member/moon/add/core";
  const headers = {
    "Content-Type": "application/json",
    Authorization: config.serverKey,
  };
  let data = {
    memberId: memberId,
    moonDate: new Date(),
  };
  try {
    const response = await axios.post(requestUrl, data, { headers });
    console.log("응답 데이터:", response.data);
  } catch (error) {
    // 오류가 발생했을 때의 처리
    console.error("POST 요청 중 오류 발생:", error);
  }
}

export { setAlaram, sendMessage, sendMoonRequest };
