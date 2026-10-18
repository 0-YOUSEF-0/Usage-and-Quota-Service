// this file start s the server 
import app from "./app";

const PORT = Number(process.env.PORT) || 3000;      // the server will run on port 3000

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});