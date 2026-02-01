import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import healthRouter from "./routes/health";

dotenv.config();

const app = express();
const PORT = process.env.PORT || {{PORT}};

app.use(cors());
app.use(express.json());

app.use("/health", healthRouter);

app.get("/", (req, res) => {
  res.json({ message: "Welcome to {{PROJECT_NAME}}" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
