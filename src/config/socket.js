const { Server } = require('socket.io');

let io = null;

const initSocket = (server, options = {}) => {
    if (io) {
        return io;
    }

    io = new Server(server, options);
    return io;
};

const getSocket = () => io;

module.exports = {
    initSocket,
    getSocket,
};
