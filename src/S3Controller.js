import config from "./config.js";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import Capture from "./models/captureModel.js";
import AWS from "aws-sdk";
import axios from "axios";
const { s3AccessKeyId, s3SecretAccessKey, s3BucketName, region } = config;
var requestUrl = "https://fcm.googleapis.com/fcm/send";

async function sendMessage(token, topic) {
  //매개변수로 가져와서 넣어주도록 수정하기
  const headers = {
    "Content-Type": "application/json",
    Authorization: config.serverKey,
  };
  let message = {
    data: {},
    notification: {
      title: "테스트 데이터 발송",
      body: "데이터가 잘 가나요?",
    },
    token: token,
    to: topic,
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
};

export default S3Controller;
