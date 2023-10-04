import mongoose from "mongoose";

const ValidMemberSchema = new mongoose.Schema({
  //memberId, isValid
  memberId: {
    type: Number,
    required: true,
  },
  isValid: {
    type: Boolean,
    default: true,
  },
});

const ValidMember = mongoose.model("ValidMember", ValidMemberSchema);

export default ValidMember;
