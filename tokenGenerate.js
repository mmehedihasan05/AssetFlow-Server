import { randomBytes } from "crypto";

const token = randomBytes(64).toString("hex");

console.log(token);
