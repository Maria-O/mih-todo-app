'use strict';

module.exports = function(app) {
	var users = require('../../app/controllers/users.server.controller');
	var events = require('../../app/controllers/events.server.controller');

	// Tasks Routes
	app.route('/events').get(events.list).post(users.requiresLogin, events.create);

	app.route('/events/:eventId').get(events.read)
		.put(users.requiresLogin, events.hasAuthorization, events.update)
		.delete(users.requiresLogin, events.hasAuthorization, events.delete);

	// Finish by binding the Event middleware
	app.param('eventId', events.eventByID);
};
