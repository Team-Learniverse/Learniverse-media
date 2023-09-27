import config from "./config.js";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import Capture from "./models/captureModel.js";
import AWS from "aws-sdk";
const { s3AccessKeyId, s3SecretAccessKey, s3BucketName, region } = config;

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
};

export default S3Controller;
