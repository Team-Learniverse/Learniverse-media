import mongoose from "mongoose";

const CaptureSchema = new mongoose.Schema({
  //promiseId, userId, comment
  coreTimeId: {
    type: Number,
    required: true,
  },
  memberId: {
    type: Number,
    required: true,
  },
  fileName: {
    type: String,
    required: true,
  },
  createdTime: {
    type: Date,
    default: Date.now,
  },
});

const Capture = mongoose.model("Capture", CaptureSchema);

export default Capture;
