const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const gravatar = require("gravatar");
const path = require("path");
const fs = require("fs/promises");
const { nanoid } = require("nanoid");

const {
  ctrlWrapper,
  HttpError,
  avatarManipulator,
  sendEmail,
} = require("../helpers");
const { User, subscriptionList } = require("../models/userMongoose");

const { SECRET_KEY, BASE_URL } = process.env;
const avatarsDir = path.join(__dirname, "../", "public", "avatars");

const register = async (req, res) => {
  const errorConflict = new HttpError(409, "Email in use");

  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (user) {
    throw errorConflict;
  }

  const hashPawword = await bcrypt.hash(password, 10);
  const avatarURL = gravatar.url(email);
  const verificationToken = nanoid();

  const newUser = await User.create({
    ...req.body,
    password: hashPawword,
    avatarURL,
    verificationToken,
  });

  const verifyEmail = {
    to: email,
    subject: "Verify email",
    html: `<a target="_blank" href="${BASE_URL}/api/users/verify/${verificationToken}">Click verify email</a>`,
  };

  await sendEmail(verifyEmail);

  res.status(201).json({
    user: {
      email: newUser.email,
      subscription: newUser.subscription,
    },
  });
};

const verifyEmail = async (req, res) => {
  const { verificationToken } = req.params;
  const user = await User.findOne({ verificationToken });

  if (!user) {
    throw new HttpError(404, "User not found");
  }

  await User.findByIdAndUpdate(user._id, {
    verify: true,
    verificationToken: null,
  });

  res.json({ message: "Verification successful" });
};

const resendVerifyEmail = async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    throw new HttpError(401, "Email not found");
  }

  if (user.verify) {
    throw new HttpError(400, "Verification has already been passed");
  }

  const verifyEmail = {
    to: email,
    subject: "Verify email",
    html: `<a target="_blank" href="${BASE_URL}/api/users/verify/${user.verificationToken}">Click verify email</a>`,
  };

  await sendEmail(verifyEmail);

  res.json({ message: "Verification email sent" });
};

const login = async (req, res) => {
  const errorAuth = new HttpError(401, "Email or password is wrong");

  const { email, password } = req.body;
  const user = await User.findOne({ email });

  if (!user) {
    throw errorAuth;
  }

  if (!user.verify) {
    throw new HttpError(401, "Email not verify");
  }

  const passwordCompare = await bcrypt.compare(password, user.password);
  if (!passwordCompare) {
    throw errorAuth;
  }

  const payload = {
    id: user._id,
  };
  const token = jwt.sign(payload, SECRET_KEY, { expiresIn: "23h" });
  await User.findByIdAndUpdate(user._id, { token });

  res.json({
    token,
    user: {
      email: user.email,
      subscription: user.subscription,
    },
  });
};

const getCurrent = async (req, res) => {
  const { email, subscription } = req.user;

  res.json({ email, subscription });
};

const logout = async (req, res) => {
  const { _id: userId } = req.user;
  await User.findByIdAndUpdate(userId, { token: null });

  res.status(204);
};

const updateSubscription = async (req, res) => {
  const errorSubscription = new HttpError(400, "Invalid subscription value");
  const { subscription } = req.body;
  const { _id: userId } = req.user;

  if (!subscription || !subscriptionList.includes(subscription)) {
    throw errorSubscription;
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { subscription },
    { new: true }
  );
  res.json({
    user: {
      email: updatedUser.email,
      subscription: updatedUser.subscription,
    },
  });
};

const updateAvatar = async (req, res) => {
  const { _id: userId } = req.user;
  const { path: tmpUpload, originalname } = req.file;

  const resultUpload = path.join(avatarsDir, originalname);
  await fs.rename(tmpUpload, resultUpload);

  await avatarManipulator(resultUpload);

  const newFileName = `${userId}_${originalname}`;
  const avatarURL = path.join("avatars", newFileName);

  await User.findByIdAndUpdate(userId, { avatarURL });

  res.json({ avatarURL });
};

module.exports = {
  register: ctrlWrapper(register),
  verifyEmail: ctrlWrapper(verifyEmail),
  resendVerifyEmail: ctrlWrapper(resendVerifyEmail),
  login: ctrlWrapper(login),
  getCurrent: ctrlWrapper(getCurrent),
  logout: ctrlWrapper(logout),
  updateSubscription: ctrlWrapper(updateSubscription),
  updateAvatar: ctrlWrapper(updateAvatar),
};
