import axios from "axios";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const REGION = "ap-south-1";
const BUCKET = "careconnect-bucket";

const s3 = new S3Client({ region: REGION });

export const handler = async (event) => {
  const record = event.Records[0];
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

  console.log("Uploaded key:", key);

  // uploads/globals/doctorId/file
  // uploads/appointments/doctorId/patientId/file
  const parts = key.split("/");

  let doctor_id = null;
  let patient_id = null;

  if (parts[1] === "globals") {
    doctor_id = parts[2];
  }

  if (parts[1] === "appointments") {
    doctor_id = parts[2];
    patient_id = parts[3];
  }

  //  create presigned url
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  const fileUrl = await getSignedUrl(s3, command, {
    expiresIn: 60 * 60, // 1 hour
  });

  console.log("Presigned URL generated", fileUrl);

  const RAG_SERVER_URL = process.env.RAG_SERVER_URL;

  await axios.post(`${RAG_SERVER_URL}/ingest`, {
    file_url: fileUrl,
    doctor_id,
    patient_id,
  });

  return { status: "success" };
};
