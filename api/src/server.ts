import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createServer } from "http";
import { Server as SocketServer } from "socket.io";
import { GameManager } from "./game";

const app = express();
app.use(express.json());

app.use((req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

const server = createServer(app);
const io = new SocketServer(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  serveClient: true,
  path: "/socket.io",
});

const game = new GameManager(io);

app.post("/admin/start-game", (req: Request, res: Response) => {
  const { password, script } = req.body || {};
  if (password !== "SHIPWRECKED113")
    return res.status(401).json({ error: "Invalid password" });
  const ok = game.startRound(script);
  if (!ok) return res.status(400).json({ error: "Round already active" });
  res.json({ success: true });
});

app.post("/admin/end-game", (req: Request, res: Response) => {
  const { password } = req.body || {};
  if (password !== "SHIPWRECKED113")
    return res.status(401).json({ error: "Invalid password" });
  game.forceEndGame();
  res.json({ success: true });
});

app.get("/admin/stats", (req: Request, res: Response) => {
  const { password } = req.query as { password?: string };
  if (password !== "SHIPWRECKED113")
    return res.status(401).json({ error: "Invalid password" });
  res.json(game.getGameStats());
});

const PORT = 5233;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
