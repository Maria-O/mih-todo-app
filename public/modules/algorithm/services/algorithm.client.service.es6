'use strict';

class TimeSlot {
	constructor(duration, priority) {
		this.duration = duration;
		this.priority = parseInt(priority, 10);
	}
}

class Slot {
	constructor(duration, priority, dayId) {
		this.duration = duration;
		this.priority = parseInt(priority, 10);
		this.start = (new Date(dayId)).setHours(0, 0, 0);
		this.end = (new Date(dayId)).setHours(23, 59, 0);
	}
}

class Day {
	static get daysMap() {
		return { 0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu',  5: 'fri', 6: 'sat' };
	};

	constructor(data) {
		Object.assign(this, data);
		this.date = new Date(this.date);
		this.settings = window.user.predefinedSettings.workingHours[Day.daysMap[this.date.getDay()]];
		this.date.setHours(0,0,0,0); //Day in database shouldn't have special time, for search methods

		if (!this.freeTime)	this.freeTime = (Algorithm.timeToMinutes(this.settings.end) - Algorithm.timeToMinutes(this.settings.start)) / 60;
		if (!this.bookedSlots) this.bookedSlots = [];
		if (!this.freeTimeStart) {
			this.freeTimeStart = new Date(this.date);
			this.freeTimeStart.setMinutes(Algorithm.timeToMinutes(this.settings.start));
		}
	}

	reserveSlot(duration, priority) {
		this.freeTime -= duration;
		this.reservedSlot = new TimeSlot(duration, priority);
	}

	bookSlot(taskId) {
		this.reservedSlot.taskId = taskId;
		this.bookedSlots.push(this.reservedSlot);
		delete this.reservedSlot;
	}

	createCalendarSlot(slot) {
		var freeTimeStart = new Date(this.freeTimeStart),
			freeTimeEnd = new Date(freeTimeStart);

		freeTimeEnd.setMinutes(freeTimeEnd.getMinutes() + slot.duration * 60);
		this.freeTimeStart = freeTimeEnd;

		return {
			type: slot.type || 'task',
			title: slot.title || 'temp',
			start: freeTimeStart,
			end: freeTimeEnd,
			className: slot.type || 'task'
		};
	}
}

class Algorithm {
	static get $inject(){
		// dependency injection
		return ['Slots', 'Authentication', 'AlgorithmServer', 'AlgorithmNegative', '$injector'];
	}
	constructor(Slots, Authentication, AlgorithmServer, AlgorithmNegative, $injector) {
		this.Slots = Slots;
		this.user = Authentication.user;
		this.AlgorithmServer = AlgorithmServer;
		this.Notification = $injector.get('Notification');

		this.AlgorithmNegative = AlgorithmNegative;

		this.slotsRange = [];
		this.priorityConfig = {
			"1" : 	{
				recommendedDuration : 3,
				isBalancedLoad : false
			},
			"2" : 	{
				recommendedDuration : 2,
				isBalancedLoad : true
			},
			"3" : 	{
				recommendedDuration : 2,
				isBalancedLoad : false
			},
			"4" : 	{
				recommendedDuration : 1,
				isBalancedLoad : true
			}
		};
	}

	generateSlots(startDate, endDate, priority, estimation) {
		startDate.setHours(0, 0, 0, 0);
		endDate.setHours(0, 0, 0, 0);

		return new Promise(resolve => {

			this.AlgorithmServer.get({
				q: 'free-time',
				start: startDate,
				end: endDate
			}, res => {
				// TODO: inconsistent object structure! First time is array, then - object.
				this.slotsRange = res.data;

				// TODO: store response data separately, because fn below has side effects,
				// TODO: overwrites, so we cannot rely on this.slotsRange if we need consistency
				this.freeSlotsGroupedByDays = res.data;

				this.getDaysRecommendations(priority, estimation);
				resolve(this.slotsRange);
			});
		});
	}

	getFreeSlots(startDate, endDate) {
		return new Promise(resolve => {
			this.AlgorithmServer.get({
				q: 'free-time',
				start: startDate,
				end: endDate
			}, res => {
				resolve(res.data);
			});
		});
	}

	getBalancedRecommendations(data) {
		var estimation = data.estimation,
			availableHoursPerDay = data.availableHoursPerDay,
			availableDaysAmount = data.availableDaysAmount,
			recommendations = {},
			balancedDuration, extraHours;

		availableHoursPerDay.sort((a, b) => a.freeTime != b.freeTime ? b.freeTime - a.freeTime : Date(b.date) - Date(a.date));
		balancedDuration = (Math.floor(estimation / availableDaysAmount * 2) / 2).toFixed(2); // Round to the nearest 0.5
		extraHours = estimation - availableDaysAmount * balancedDuration;

		availableHoursPerDay.map(function(day) {
			day.proposedSlotDuration = (extraHours >= 0.5 ? (extraHours -= 0.5, 0.5) : 0) + parseFloat(balancedDuration);
			recommendations[day.date] = day.proposedSlotDuration;
			return day
		});

		return recommendations;
	}

	getIntensiveRecommendations(data) {

		var hoursToDistribute = data.estimation,
			availableHoursPerDay = data.availableHoursPerDay,
			availableDaysAmount = data.availableDaysAmount,
			recommendedDuration = data.recommendedDuration,
			dayIndex = 0,
			arrayWithRecommendations = new Array(availableDaysAmount).fill(0),
			recommendations = {},
			slot;

		while (hoursToDistribute) {
			slot = hoursToDistribute >= recommendedDuration ? recommendedDuration : hoursToDistribute;
			arrayWithRecommendations[dayIndex] += slot;
			hoursToDistribute -= slot;
			dayIndex = dayIndex < availableDaysAmount-1 ? dayIndex + 1 : 0;
		}

		availableHoursPerDay.sort((a, b) => Date(a.date) - Date(b.date));
		availableHoursPerDay.map(function(day, dayIndex) {
			day.proposedSlotDuration = arrayWithRecommendations[dayIndex];
			recommendations[day.date] = arrayWithRecommendations[dayIndex];
			return day;
		});

		return recommendations;
	}

	getSuitableSlots(recommendations, priority) {
		var suitableSlots = [],
			slot;
		Object.keys(this.slotsRange).forEach(dayId => {
			let slotDuration = recommendations[dayId];
			if (!slotDuration) return;

			slot = new Slot(slotDuration, priority, dayId);
			suitableSlots.push(slot);
		});

		return suitableSlots;
	}

	getFreeHoursDailyMapFromSlots(freeSlotsByDays) {
		return _.map(freeSlotsByDays, function(dayFreeSlots, dayId) {
			let day = {
				freeTime: _(dayFreeSlots).map(slot => slot.duration).sum(),
				date: dayId
			};
			return day;
		});
	}

	getTotalFreeHoursInDailyMap(dailyMap) {
		return _.sum(dailyMap.map(day => day.freeTime));
	}

	getTimeAvailabilityFromSlotsGroupedByDays() {
		let dailyMap = this.getFreeHoursDailyMapFromSlots(this.freeSlotsGroupedByDays);
		let totalAvailHours = this.getTotalFreeHoursInDailyMap(dailyMap);
		return {
			dailyMap,
			totalAvailHours
		};
	}

	getDaysRecommendations(priority, estimation) {
		let {dailyMap, totalAvailHours} = this.getTimeAvailabilityFromSlotsGroupedByDays();

		var data = {
				estimation,
				availableHoursPerDay: dailyMap,
				availableDaysAmount: dailyMap.length,
				recommendedDuration: this.priorityConfig[priority].recommendedDuration
			},
			isBalancedLoad = this.priorityConfig[priority].isBalancedLoad,
			recommendations = {};

		if (estimation <= totalAvailHours) {
			//Positive branch

			recommendations = isBalancedLoad ? this.getBalancedRecommendations(data) : this.getIntensiveRecommendations(data);

		} else {
			// Negative branch
      //check if new object is task or event and pass argument!!!
      this.AlgorithmNegative.openModalForDecision('task');
			//this.Notification.warning(`not sufficient free time. Please, reduce task estimation, or increase deadline.`);
		}
		this.slotsRange = this.getSuitableSlots(recommendations, priority);
	}

	static timeToMinutes(time) {
		return time.split(':').reduce((prev, cur) => ((parseInt(prev, 10)) * 60) + parseInt(cur, 10));
	}

	static minutesToTime(minutes) {
		return [
			('0' + Math.floor(minutes / 60)).substr(-2),
			('0' + minutes % 60).substr(-2)
		].join(':');
	}
}

angular.module('algorithm').service('Algorithm', Algorithm);
