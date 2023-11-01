import mongoose from "mongoose";

const ActiveMemberSchema = new mongoose.Schema({
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

const ActiveMember = mongoose.model("ActiveMember", ActiveMemberSchema);

export default ActiveMember;
