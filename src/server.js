const http = require("http");
const app = require("./app");
const { setupSocket } = require("./sockets");

const server = http.createServer(app);
setupSocket(server);

server.listen(process.env.PORT || 3000, () => {
    console.log(`Server is running on port ${process.env.PORT || 3000}`);
});