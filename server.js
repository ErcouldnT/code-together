const path = require('path');
const express = require('express');
const app = express();
// app.enable('trust proxy');
const mongoose = require("mongoose");
const Document = require("./model/Document");
require('dotenv').config();

app.use('/', express.static(path.join(__dirname, 'client', 'dist')));

mongoose.connect(process.env.MONGO_URI, {
  useCreateIndex: true,
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useFindAndModify: false,
}, () => console.log("Mongo connected!"));


const server = app.listen(process.env.PORT || 5000, () => {
  const host = process.env.NODE_ENV === "development" ? 'localhost' : 'together.erkuttekoglu.com';
  const port = server.address().port;
  console.log('Listening on http://' + host + ':' + port + '/');
});

const io = require('socket.io')(server);

const defaultValue = "";

io.on("connection", socket => {
  socket.on("get-document", async documentId => {
    const document = await findOrCreateDocument(documentId);
    socket.join(documentId);
    socket.emit("load-document", document.data);

    socket.on("send-changes", delta => {
      socket.broadcast.to(documentId).emit("receive-changes", delta);
    });

    socket.on("save-document", async data => {
      await Document.findByIdAndUpdate(documentId, { data });
    });
  });
});

async function findOrCreateDocument(id) {
  if (id == null) return;

  const document = await Document.findById(id);
  if (document) return document;
  return await Document.create({ _id: id, data: defaultValue });
};
