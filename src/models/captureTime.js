import mongoose from "mongoose";

const CaptureTimeSchema = new mongoose.Schema({
  //coreTimeId, captureTime
  coreTimeId: {
    type: Number,
    required: true,
  },
  captureTime: {
    type: Date,
  },
});

const CaptureTime = mongoose.model("CaptureTime", CaptureTimeSchema);

export default CaptureTime;
