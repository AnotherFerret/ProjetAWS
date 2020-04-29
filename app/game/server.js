var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var Entities = require('html-entities').AllHtmlEntities;
var entities = new Entities();


var BattleshipGame = require('./gameapp.js');
var GameStatus = require('./game_status.js');

var port = 8900;

var users = {};
var usersFromDB = [];

var gameIdCounter = 1;

app.use(express.static(__dirname));

http.listen(port, function(){
  console.log('listening on *:' + port);
});




//**************************************** LOGIN AND REGISTER  ****************************** */

var mysql = require('mysql');
var session = require('express-session');
var bodyParser = require('body-parser');
var path = require('path');

var connection = mysql.createConnection({
	host     : 'localhost',
	user     : 'root',
	password : '',
	database : 'TRY1'
});

app.use(session({
	secret: 'secret',
	resave: true,
	saveUninitialized: true
}));

app.use(bodyParser.urlencoded({extended : true}));
app.use(bodyParser.json());
app.use(express.static('/Users/mac/Desktop/AWS'));

app.get('/', function(request, response) {
  response.sendFile('/Users/mac/Desktop/AWS/index.html');
});

app.get('/login', function(request, response) {
  response.sendFile('/Users/mac/Desktop/AWS/login.html');
});
app.get('/register1', function(request, response) {
  response.sendFile('/Users/mac/Desktop/AWS/register.html');
});
app.post('/login', function(request, response) {
	var mail = request.body.email_cnx;
  var password = request.body.mdp_cnx;

	if (mail && password) {
		connection.query('SELECT nickname FROM player WHERE mail = ? AND password = ?', [mail, password], function(error, result, fields) {
			if (result) {
        usersFromDB.push(result)
        request.session.loggedin = true;
        console.log(result);
				request.session.username = result[0].nickname;
				response.writeHead(302, {
					'Location': 'accueil.html'
				  });
				  response.end();
						} else {
        console.log(result);
				response.send('Incorrect Username and/or Password!');
			}			
			response.end();
		});
	} else {
		response.send('Please enter Username and Password!');
		response.end();
	}
});

app.post('/register1', function(request, response) {
	var mail = request.body.email;
  var password = request.body.password;
  var nickname= request.body.fname + request.body.lname;
	console.log("Registering!");
	connection.query('INSERT INTO player (nickname, mail, password) VALUES (?, ?, ?)',[nickname, mail, password], function (err, result) {
	  if (err) throw err;
      {console.log("1 record inserted");
      response.writeHead(302, {
        'Location': 'login.html'
      });
      response.end();
    }
	});

});
app.get('/home', function(request, response) {
	if (request.session.loggedin) {
		response.send('Welcome back, ' + request.session.username + '!');
	} else {
		response.send('Please login to view this page!');
	}
	response.end();
});

var id = 1;


// connection.connect(function(err) {
// 	if (err) throw err;
// 	connection.query("SELECT * FROM friends WHERE id_a = ? or id_b = ?",[id, id], function (err, result, fields) {
// 	  if (err) throw err;
// 	  var j = result.length;
// 	  let friends = [];
// 	  for( i = 0; i<j; i++){
// 		  if(result[i].id_a == 1)
// 			  friends.push(result[i].id_b);
// 		  else
// 		  	friends.push(result[i].id_a);
// 	  }
// 	  	// console.log(friends);
// 	});
// });



//**************************************** LOGIN AND REGISTER  ****************************** */



//créé l'utilisateur lors de la connexion et l'ajoute à la salle d'attente
io.on('connection', function(socket) {
  console.log(' ID ' + socket.id + ' connecté.');

  users[socket.id] = {
    inGame: null,
    player: null
    }; 

  socket.join('Attente');

  //tir du joueur
  socket.on('shot', function(position) {
    var game = users[socket.id].inGame, opponent;

    if(game !== null) {
      if(game.currentPlayer === users[socket.id].player) {
        opponent = game.currentPlayer === 0 ? 1 : 0;

        if(game.shoot(position)) {
          //tir valide
          checkGameOver(game);

          //mise à jour des clients
          io.to(socket.id).emit('update', game.getGameState(users[socket.id].player, opponent));
          io.to(game.getPlayerId(opponent)).emit('update', game.getGameState(opponent, opponent));
        }
      }
    }
  });
  
  //quitte la partie
  socket.on('leave', function() {
    if(users[socket.id].inGame !== null) {
      leaveGame(socket);

      socket.join('Attente');
      joinWaitingPlayers();
    }
  });

  //Deconnexion
  socket.on('disconnect', function() {
    
    leaveGame(socket);

    delete users[socket.id];
  });

  joinWaitingPlayers();
});

//créé nouvelle partie si 2+ joueurs
function joinWaitingPlayers() {
  var players = getClientsInRoom('Attente');
  
  if(players.length > 1) {
    var game = new BattleshipGame(gameIdCounter++, players[0].id, players[1].id);

    //quitte attente et créé nouvelle room pour jouer
    players[0].leave('Attente');
    players[1].leave('Attente');
    players[0].join('game' + game.id);
    players[1].join('game' + game.id);

    users[players[0].id].player = 0;
    users[players[1].id].player = 1;
    users[players[0].id].inGame = game;
    users[players[1].id].inGame = game;
    
    io.to('game' + game.id).emit('join', game.id);

    io.to(players[0].id).emit('update', game.getGameState(0, 0));
    io.to(players[1].id).emit('update', game.getGameState(1, 1));

    console.log(players[0].id + " et " + players[1].id + " ont rejoint :  " + game.id);
  }
}

//quitte la partie
function leaveGame(socket) {
  if(users[socket.id].inGame !== null) {

    if(users[socket.id].inGame.gameStatus !== GameStatus.gameOver) {
      //si joueur null et partie non terminée
      users[socket.id].inGame.abortGame(users[socket.id].player);
      checkGameOver(users[socket.id].inGame);
    }

    socket.leave('game' + users[socket.id].inGame.id);

    users[socket.id].inGame = null;
    users[socket.id].player = null;

    io.to(socket.id).emit('leave');
  }
}

//quand partie terminée
function checkGameOver(game) {
  if(game.gameStatus === GameStatus.gameOver) {
    io.to(game.getWinnerId()).emit('gameover', true);
    io.to(game.getLoserId()).emit('gameover', false);
  }
}

//récupère les joueurs dans une room
function getClientsInRoom(room) {
  var clients = [];
  for (var id in io.sockets.adapter.rooms[room]) {
    clients.push(io.sockets.adapter.nsp.connected[id]);
  }
  return clients;
}
