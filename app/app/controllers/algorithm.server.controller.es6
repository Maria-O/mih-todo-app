'use strict';

var mongoose = require('mongoose'),
	errorHandler = require('./errors.server.controller'),
	Slot = mongoose.model('Slot'),
	_ = require('lodash');

var weekMap = { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu',  5: 'fri', 6: 'sat' };
var formatDateForKey = date => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
var timeToMinutes = time=> time.split(':').reduce((prev, cur) => ((parseInt(prev, 10)) * 60) + parseInt(cur, 10));

export class AlgorithmServerController {
	static getFreeTime(req, res) {
		var start = new Date(req.query.start),
			end = new Date(req.query.end);

		start.setHours(0, 0, 0, 0);
		end.setHours(24, 0, 0, 0);

		Slot.find({
			start: {$gte: start},
			end: {$lte: end}
		}).exec((err, slots) => {
			if(err) {
				return res.status(400).send({
					message: errorHandler.getErrorMessage(err)
				});
			}

			var daysRange = {};

			//Create day maps
			var	startDate = new Date(start);

			while(startDate < end) {
				let dayOptions = req.user.predefinedSettings.workingHours[weekMap[startDate.getDay()]];

				if (dayOptions.isWorkingDay) {
					let start = new Date(startDate);
					start.setMinutes(timeToMinutes(dayOptions.start));

					let end = new Date(startDate);
					end.setMinutes(timeToMinutes(dayOptions.end));

					daysRange[formatDateForKey(startDate)] = [{
						start: start,
						end: end,
						duration : (end - start)/3600000
					}];
				}

				startDate = new Date(startDate.setDate(startDate.getDate() + 1));
			}

			//Calculate free time left for days
			slots.forEach(slot => {
				let dayTime = daysRange[formatDateForKey(slot.start)];

				dayTime.forEach((time, index) => {
					//Set Date to ISODate
					slot.start = new Date(slot.start);
					slot.start.setHours(slot.start.getHours() - 3);
					slot.end = new Date(slot.end);
					slot.end.setHours(slot.end.getHours() - 3);

					if (time.start <= slot.start && time.end >= slot.end) {
						if (slot.start.toString() == time.start.toString() && slot.end.toString() == time.end.toString()) { //No time left in slot
							dayTime.splice(index, 1);
						} else if (time.start < slot.start && time.end > slot.end) { //There are free time in both start and end of slot
							dayTime[index] = {start: time.start, end: slot.start};
							dayTime.splice(index, 0, {start: slot.end, end: time.end});
						} else if(time.start < slot.start) { //There is free time left in the start of slot
							dayTime[index] = {start: time.start, end: slot.start};
						} else if (slot.end < time.end) { //There is free time left in the end of slot
							dayTime[index] = {start: slot.end, end: time.end};
						}
					}
				})
			});
			res.json({data : daysRange});
		});
	}
}
