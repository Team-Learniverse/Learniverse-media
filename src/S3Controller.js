import config from "./config.js";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import Capture from "./models/captureModel.js";
import AWS from "aws-sdk";
import axios from "axios";
import CaptureTime from "./models/captureTime.js";
import schedule from "node-schedule";

const { s3AccessKeyId, s3SecretAccessKey, s3BucketName, region } = config;
var requestUrl = "https://fcm.googleapis.com/fcm/send";

function getUTCTime(curr) {
  const utc = curr.getTime() + curr.getTimezoneOffset() * 60 * 1000;
  //ec2 배포되어있는 주 기준
  const KR_TIME_DIFF = 9 * 60 * 60 * 1000;
  const kr_curr = new Date(utc - KR_TIME_DIFF);
  return kr_curr;
}

function getNowKorTime() {
  const curr = new Date();
  const utc = curr.getTime() + curr.getTimezoneOffset() * 60 * 1000;
  //ec2 배포되어있는 주 기준
  const KR_TIME_DIFF = 9 * 60 * 60 * 1000;
  const kr_curr = new Date(utc + KR_TIME_DIFF);
  return kr_curr;
}

async function sendMessage(resJson) {
  let { tokens, topic } = resJson;
  topic = "/topics/" + topic.toString();
  console.log(`알림: ${new Date()}에 알림을 보냅니다.\n`);
  console.log("sendMessage 호출 + coreTimeId=", topic, "/tokens=", tokens);
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
    registration_ids: tokens,
  };
  try {
    const response = await axios.post(requestUrl, message, { headers });

    console.log("응답 데이터:", response.data);
  } catch (error) {
    // 오류가 발생했을 때의 처리
    console.error("POST 요청 중 오류 발생:", error);
  }
}

const credentials = new AWS.SharedIniFileCredentials({
  profile: "work-account",
});
AWS.config.credentials = credentials;

AWS.config.update({
  region: region,
  accessKeyId: s3AccessKeyId,
  secretAccessKey: s3SecretAccessKey,
});
const s3 = new AWS.S3();

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

async function getPresignedUrl(fileName) {
  const params = {
    Bucket: s3BucketName,
    Key: fileName,
    Expires: 180,
  };

  const url = s3.getSignedUrl("getObject", params);
  return url;
}

const S3Controller = {
  async testFunc(req, res) {
    res.send("ok");
  },
  async createCaptureInfo(req, res) {
    //이미지 정보 생성
    try {
      const { coreTimeId, memberId, fileName } = req.body;
      const createdCatpure = new Capture({
        coreTimeId,
        memberId,
        fileName,
      });
      const savedCapture = await createdCatpure.save();
      console.log(savedCapture);
      res.status(200).send(savedCapture);
    } catch (err) {
      res.send({ error: err });
    }
  },
  async getCaptures(req, res) {
    try {
      const { coreTimeId } = req.query;
      const captureList = await Capture.find()
        .where("coreTimeId")
        .equals(coreTimeId);

      let presignedUrlList = [];
      for (let capture of captureList) {
        console.log(capture.fileName);
        const presignedUrl = await getPresignedUrl(capture.fileName);
        console.log(presignedUrl);

        presignedUrlList.push({
          memberId: capture.memberId,
          fileLink: presignedUrl,
          createdTime: capture.createdTime,
        });
      }
      console.log(presignedUrlList);
      res.status(200).json(presignedUrlList);
    } catch (err) {
      console.log(err);
      res.send({ error: err });
    }
  },
  async getUploadPresigned(req, res) {
    try {
      const { fileName } = req.query;
      const clientUrl = await createPresignedUrlWithClient({
        region: "us-east-2",
        bucket: s3BucketName,
        key: fileName,
      });

      res.send(clientUrl);
    } catch (err) {
      res.send({ error: err });
    }
  },
  async createCaptureTime(req, res) {
    //이미지 정보 생성
    try {
      let { coreTimeId, startTime, endTime, captureCount, tokens } = req.body;
      startTime = new Date(startTime);
      endTime = new Date(endTime);

      const nowKor = getNowKorTime();
      // if (startTime < nowKor || endTime < nowKor) {
      //   console.log("코어타임 시작/끝 시간이 현재보다 과거입니다.");
      //   res
      //     .status(400)
      //     .send({ error: "코어타임 시작/끝 시간이 현재보다 과거입니다." });
      //   return;
      // }
      const timeDiff = (endTime - startTime) / (captureCount + 1);

      let times = [];
      let lastTime = startTime;
      console.log(
        "코어타임 생성\n",
        startTime,
        endTime,
        timeDiff,
        nowKor,
        "\n"
      );

      let alarmTimes = [];
      for (let i = 0; i < captureCount; i++) {
        lastTime = new Date(lastTime.getTime() + timeDiff);
        const createdCatpure = new CaptureTime({
          coreTimeId,
          captureTime: lastTime,
        });
        const savedTime = await createdCatpure.save();
        //스케줄러 호출
        alarmTimes.push(lastTime);
        if (i != captureCount - 1) times.push(savedTime);
      }
      alarmTimes.forEach((time) => {
        console.log(time);
        const targetDateTime = new Date(time);
        console.log(targetDateTime, "\n\n");

        const rule = new schedule.RecurrenceRule();
        rule.year = targetDateTime.getFullYear();
        rule.month = targetDateTime.getMonth();
        rule.date = targetDateTime.getDate();
        rule.hour = targetDateTime.getHours();
        rule.minute = targetDateTime.getMinutes();
        rule.second = targetDateTime.getSeconds();

        schedule.scheduleJob(
          rule,
          sendMessage.bind(null, { tokens, topic: coreTimeId })
        );
      });

      res.status(200).json(times);
    } catch (err) {
      console.log(err);
      res.send({ error: err });
    }
  },
  async getCaptureTime(req, res) {
    try {
      const { coreTimeId } = req.query;
      const captureTimeList = await CaptureTime.find()
        .where("coreTimeId")
        .equals(coreTimeId);

      res.status(200).json(captureTimeList);
    } catch (err) {
      console.log(err);
      res.send({ error: err });
    }
  },
};

export default S3Controller;
