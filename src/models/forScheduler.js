import mongoose from "mongoose";

const forSchedulerSchema = new mongoose.Schema({
  //memberId:멤버 닉네임, isValid
  memberId: {
    type: String,
    required: true,
  },
  coreTimeId: {
    type: Number,
    default: true,
  },
});

const forScheduler = mongoose.model("forScheduler", forSchedulerSchema);

export default forScheduler;
