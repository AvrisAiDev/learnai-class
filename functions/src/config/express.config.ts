import express from "express";
import cors from "cors";
import { GcpLogger } from "../middlewares/logger";

const app = express();

const logger = new GcpLogger();
app.use(cors({ origin: true }));
app.use(express.json());
app.use(logger.request());

export const appRef = app;
