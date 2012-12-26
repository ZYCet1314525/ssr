// Generated by CoffeeScript 1.4.0
(function() {
  var KEY, PORT, REMOTE_PORT, SERVER, config, configContent, configFromArgs, decryptTable, encrypt, encryptTable, fs, getServer, http, inetAton, inetNtoa, k, myScheduler, net, path, scheduler, server, tables, timeout, v;

  inetNtoa = function(buf) {
    return buf[0] + "." + buf[1] + "." + buf[2] + "." + buf[3];
  };

  inetAton = function(ipStr) {
    var buf, i, parts;
    parts = ipStr.split(".");
    if (parts.length !== 4) {
      return null;
    } else {
      buf = new Buffer(4);
      i = 0;
      while (i < 4) {
        buf[i] = +parts[i];
        i++;
      }
      return buf;
    }
  };

  fs = require("fs");

  path = require("path");

  http = require("http");

  scheduler = require('./scheduler');

  configContent = fs.readFileSync(path.resolve(__dirname, "config.json"));

  config = JSON.parse(configContent);

  configFromArgs = require('./args').parseArgs();

  for (k in configFromArgs) {
    v = configFromArgs[k];
    config[k] = v;
  }

  SERVER = config.server;

  REMOTE_PORT = 80;

  PORT = config.local_port;

  KEY = config.password;

  timeout = Math.floor(config.timeout * 1000);

  myScheduler = new scheduler.Scheduler(SERVER);

  getServer = function() {
    return myScheduler.getServer();
  };

  net = require("net");

  encrypt = require("./encrypt");

  console.log("calculating ciphers");

  tables = encrypt.getTable(KEY);

  encryptTable = tables[0];

  decryptTable = tables[1];

  server = net.createServer(function(connection) {
    var aServer, addrLen, addrToSend, cachedPieces, headerLength, remote, remoteAddr, remotePort, req, stage;
    console.log("server connected");
    console.log("concurrent connections: " + server.connections);
    stage = 0;
    headerLength = 0;
    remote = null;
    req = null;
    cachedPieces = [];
    addrLen = 0;
    remoteAddr = null;
    remotePort = null;
    addrToSend = "";
    aServer = getServer();
    connection.on("data", function(data) {
      var addrtype, buf, cmd, reply, tempBuf;
      if (stage === 5) {
        encrypt.encrypt(encryptTable, data);
        if (!remote.write(data)) {
          connection.pause();
        }
        return;
      }
      if (stage === 0) {
        tempBuf = new Buffer(2);
        tempBuf.write("\u0005\u0000", 0);
        connection.write(tempBuf);
        stage = 1;
        return;
      }
      if (stage === 1) {
        try {
          cmd = data[1];
          addrtype = data[3];
          if (cmd !== 1) {
            console.warn("unsupported cmd: " + cmd);
            reply = new Buffer("\u0005\u0007\u0000\u0001", "binary");
            connection.end(reply);
            return;
          }
          if (addrtype === 3) {
            addrLen = data[4];
          } else if (addrtype !== 1) {
            console.warn("unsupported addrtype: " + addrtype);
            connection.end();
            return;
          }
          addrToSend = data.slice(3, 4).toString("binary");
          if (addrtype === 1) {
            remoteAddr = inetNtoa(data.slice(4, 8));
            addrToSend += data.slice(4, 10).toString("binary");
            remotePort = data.readUInt16BE(8);
            headerLength = 10;
          } else {
            remoteAddr = data.slice(5, 5 + addrLen).toString("binary");
            addrToSend += data.slice(4, 5 + addrLen + 2).toString("binary");
            remotePort = data.readUInt16BE(5 + addrLen);
            headerLength = 5 + addrLen + 2;
          }
          buf = new Buffer(10);
          buf.write("\u0005\u0000\u0000\u0001", 0, 4, "binary");
          buf.write("\u0000\u0000\u0000\u0000", 4, 4, "binary");
          buf.writeInt16BE(remotePort, 8);
          connection.write(buf);
          req = http.request({
            host: aServer,
            port: REMOTE_PORT,
            headers: {
              'Connection': 'Upgrade',
              'Upgrade': 'websocket'
            }
          });
          req.setNoDelay(true);
          req.end();
          req.setTimeout(timeout, function() {
            req.abort();
            return connection.end();
          });
          req.on('error', function() {
            console.warn('req error');
            req.abort();
            return connection.end();
          });
          req.on('upgrade', function(res, conn, upgradeHead) {
            var addrToSendBuf, i, piece;
            remote = conn;
            console.log("remote got upgrade");
            console.log("connecting " + remoteAddr + " via " + aServer);
            addrToSendBuf = new Buffer(addrToSend, "binary");
            encrypt.encrypt(encryptTable, addrToSendBuf);
            remote.write(addrToSendBuf);
            i = 0;
            while (i < cachedPieces.length) {
              piece = cachedPieces[i];
              encrypt.encrypt(encryptTable, piece);
              remote.write(piece);
              i++;
            }
            cachedPieces = null;
            stage = 5;
            remote.on("data", function(data) {
              encrypt.encrypt(decryptTable, data);
              if (!connection.write(data)) {
                return remote.pause();
              }
            });
            remote.on("end", function() {
              console.log("remote disconnected");
              connection.end();
              return console.log("concurrent connections: " + server.connections);
            });
            remote.on("error", function() {
              myScheduler.serverFailed(aServer);
              if (stage === 4) {
                console.warn("remote connection refused");
                connection.destroy();
                return;
                console.warn("remote error");
                connection.end();
              }
              return console.log("concurrent connections: " + server.connections);
            });
            remote.on("drain", function() {
              return connection.resume();
            });
            return remote.setTimeout(timeout, function() {
              connection.end();
              return remote.destroy();
            });
          });
          if (data.length > headerLength) {
            buf = new Buffer(data.length - headerLength);
            data.copy(buf, 0, headerLength);
            cachedPieces.push(buf);
            buf = null;
          }
          return stage = 4;
        } catch (e) {
          console.warn(e);
          connection.destroy();
          if (remote) {
            return remote.destroy();
          }
        }
      } else {
        if (stage === 4) {
          return cachedPieces.push(data);
        }
      }
    });
    connection.on("end", function() {
      myScheduler.serverSucceeded(aServer);
      console.log("server disconnected");
      if (remote) {
        console.log("remote.destroy()");
        remote.destroy();
      } else if (req) {
        console.log("req.abort()");
        req.abort();
      }
      return console.log("concurrent connections: " + server.connections);
    });
    connection.on("error", function() {
      console.warn("server error");
      if (req) {
        req.abort();
      }
      if (remote) {
        remote.destroy();
      }
      return console.log("concurrent connections: " + server.connections);
    });
    connection.on("drain", function() {
      if (remote && stage === 5) {
        return remote.resume();
      }
    });
    return connection.setTimeout(timeout, function() {
      if (req) {
        req.abort();
      }
      if (remote) {
        remote.destroy();
      }
      return connection.destroy();
    });
  });

  server.listen(PORT, function() {
    return console.log("server listening at port " + PORT);
  });

  server.on("error", function(e) {
    if (e.code === "EADDRINUSE") {
      return console.warn("Address in use, aborting");
    }
  });

}).call(this);
