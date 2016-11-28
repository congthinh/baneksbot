/**
 * Created by Александр on 13.12.2015.
 */
module.exports = function (express, mongo) {
    var router = express.Router(),
        vkApi = require('../helpers/vk'),
        q = require('q'),
        botApi = require('../helpers/bot');

    var commands = {
            '/anek': function (command, message) {
                if (command[1] == 'count') {
                    return mongo.Anek.count().then(function (count) {
                        return botApi.sendMessage(message.chat.id, 'Всего анеков на данный момент: ' + count);
                    })
                } else if (command[1] && (!isNaN(parseInt(command[1])))) {
                    return mongo.Anek.findOne().skip(parseInt(command[1]) - 1).exec().then(function (anek) {
                        return botApi.sendMessage(message.chat.id, anek);
                    }).catch(console.error);
                }
                return mongo.Anek.random().then(function (anek) {
                    return botApi.sendMessage(message.chat.id, anek);
                })
            },
            '/start': function (command, message) {
                return botApi.sendMessage(message.chat.id, 'Просто отправь мне /anek и обещаю, мы подружимся.');
            },
            '/help': function (command, message) {
                return botApi.sendMessage(message.chat.id, 'Просто отправь мне /anek и обещаю, мы подружимся.');
            },
            '/find': function (command, message) {
                return botApi.sendMessage(message.chat.id, 'Поиск временно не работает, сори');
            },
            '/subscribe': function (command, message) {
                return mongo.User.findOne({user_id: message.from.id}).then(function (user) {
                    if (user) {
                        if (!user.subscribed) {
                            return mongo.User.update({_id: user.id}, {subscribed: true}).then(function () {
                                return botApi.sendMessage(message.from.id, 'Окей, подпишем тебя снова.');
                            });
                        } else {
                            return botApi.sendMessage(user.user_id, 'Чувак, тыж уже подписан?!');
                        }
                    }
                    var newUser = new mongo.User({
                        user_id: message.from.id,
                        first_name: message.from.first_name,
                        last_name: message.from.last_name,
                        username: message.from.username,
                        platform: 'web',
                        subscribed: true
                    });
                    return newUser.save().then(function (user) {
                        return botApi.sendMessage(user.user_id, 'Окей, ' + user.first_name + '. Буду присылать тебе анеки по мере поступления.');
                    });
                }).catch(function (error) {
                    console.log(error);
                    return botApi.sendMessageToAdmin('subscribe fail' + JSON.stringify(error));
                });
            },
            '/unsubscribe': function (command, message) {
                return mongo.User.findOne({user_id: message.from.id}).then(function (user) {
                    if (user && user.subscribed) {
                        return mongo.User.update({_id: user.id}, {subscribed: false}).then(function () {
                            return botApi.sendMessage(message.from.id, 'Хорошо, больше не буду отправлять =(');
                        });
                    }
                    return botApi.sendMessage(message.from.id, 'Чувак, ты и так не подписан.');
                }).catch(function (error) {
                    console.log(error);
                    return botApi.sendMessageToAdmin('unsubscribe fail' + JSON.stringify(error));
                });
            },
            '/top_day': function (command, message) {
                var count =  Math.max(Math.min(parseInt(command[1]) || 1, 20), 1);
                return mongo.Anek
                    .find({})
                    .where({date: {$gte: Math.floor(new Date().getTime() / 1000) - 24 * 60 * 60 }})
                    .sort({likes: -1})
                    .limit(count)
                    .exec()
                    .then(function (aneks) {
                        return q.all(aneks.concat(botApi.sendMessage(message.chat.id, 'Топ ' + count + ' за сутки:')).map(function (anek) {
                            return botApi.sendMessage(message.chat.id, anek);
                    }));
                });
            },
            '/top_week': function (command, message) {
                var count =  Math.max(Math.min(parseInt(command[1]) || 3, 20), 1);
                return mongo.Anek
                    .find({})
                    .where({date: {$gte: Math.floor(new Date().getTime() / 1000) - 24 * 60 * 60 * 7 }})
                    .sort({likes: -1})
                    .limit(count)
                    .exec()
                    .then(function (aneks) {
                        return q.all(aneks.concat(botApi.sendMessage(message.chat.id, 'Топ ' + count + ' за неделю:')).map(function (anek) {
                            return botApi.sendMessage(message.chat.id, anek);
                    }));
                });
            },
            '/top_month': function (command, message) {
                var count =  Math.max(Math.min(parseInt(command[1]) || 5, 20), 1);
                return mongo.Anek
                    .find({})
                    .where({date: {$gte: Math.floor(new Date().getTime() / 1000) - 24 * 60 * 60 * 30 }})
                    .sort({likes: -1})
                    .limit(count)
                    .exec()
                    .then(function (aneks) {
                        return q.all(aneks.concat(botApi.sendMessage(message.chat.id, 'Топ ' + count + ' за месяц:')).map(function (anek) {
                            return botApi.sendMessage(message.chat.id, anek);
                    }));
                });
                //return botApi.sendMessageToAdmin('top month ' + JSON.stringify(data));
            },
            '/top_ever': function (command, message) {
                var count =  Math.max(Math.min(parseInt(command[1]) || 10, 20), 1);
                return mongo.Anek
                    .find({})
                    .sort({likes: -1})
                    .limit(count)
                    .exec()
                    .then(function (aneks) {
                        return q.all(aneks.concat(botApi.sendMessage(message.chat.id, 'Топ ' + count + ' за все время:')).map(function (anek) {
                            return botApi.sendMessage(message.chat.id, anek);
                    }));
                });
                //return botApi.sendMessageToAdmin('top ever ' + JSON.stringify(data));
            }
        },
        performCommand = function (command, data) {
            return commands[command[0]].call(botApi, command, data);
        },
        performWebHook = function (data) {
            var result;
            if (data.inline_query) {
                console.log('Execute inline query');
            } else if (data.message) {
                var message = data.message,
                    command = (message.text || '').split(' ');

                if (message.new_chat_member) {
                    result = botApi.sendMessage(message.chat.id, 'Эгегей, ёбанный в рот!');
                } else if (message.new_chat_member) {
                    result = botApi.sendMessage(message.chat.id, 'Мы не будем сильно скучать.');
                } else {
                    if (command[0].indexOf('@') >= 0) {
                        command[0] = command[0].split('@')[0];
                    }

                    if (commands[command[0]]) {
                        result = performCommand(command, data.message);
                    } else {
                        console.error('Unknown command', data);
                        throw new Error('Command not found: ' + command.join(' '));
                    }
                }
            } else {
                throw new Error('No messge specified');
            }
            return result;
        },
        clearDatabases = function () {
            return q.all([
                mongo.Anek.remove({}),
                mongo.Comment.remove({})
            ]);
        },
        getAllAneks = function (start) {
            return vkApi.getPostsCount().then(function (counter) {
                var requests = [],
                    current = counter - (start || 0),
                    goal = 0,
                    maxStep = 100,
                    step = maxStep;

                while (current > goal) {
                    if (current - step < goal) {
                        step = current - goal;
                    }

                    current -= step;

                    requests.push(vkApi.getPosts({offset: current, count: step}));
                }

                return q.all(requests);
            })
        },
        redefineDatabase = function (count) {
            return getAllAneks(count).then(function (responses) {
                return q.all(responses.map(function (response) {
                    return mongo.Anek.collection.insertMany(response.response.items.reverse().map(function (anek) {
                        anek.post_id = anek.id;
                        anek.likes = anek.likes.count;
                        anek.reposts = anek.reposts.count;
                        delete anek.id;
                        return anek;
                    })).catch(function (error) {
                        console.log(error);
                        return [];
                    });
                }));
            })
        };

    router.get('/', function (req, res) {
        return res.send('hello fot Telegram bot api');
    });

    router.get('/getMe', function (req, res, next) {
        return botApi.getMe().then(function (response) {
            return res.send(JSON.stringify(response));
        }).catch(next);
    });

    router.get('/toAdmin', function (req, res, next) {
        return botApi.sendMessageToAdmin(req.query.text || '').then(function (response) {
            return res.send(JSON.stringify(response));
        }).catch(next);
    });

    router.route('/webhook')
        .post(function (req, res, next) {
            return performWebHook(req.body).then(function (response) {
                return res.json(response);
            }).catch(next);
        });

    router.get('/redefine', function (req, res, next) {
        return clearDatabases().then(redefineDatabase.bind(this, 0)).then(function (response) {
            return res.json('success ' + response.length);
        }).catch(function (error) {
            console.log(error);
            return next(error);
        });
    });

    router.get('/command', function (req, res, next) {
        return performWebHook({
            message: {
                text: req.query.query,
                chat: {
                    id: botApi.config.adminChat
                },
                from: {
                    first_name: 'Alexander',
                    last_name: 'Bareyko',
                    username: 'energizer91',
                    id: botApi.config.adminChat
                }
            }
        }).then(function (response) {
            return res.json(response);
        }).catch(next);
    });

    return {
        endPoint: '/bot',
        router: router
    };
};