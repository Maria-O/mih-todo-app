'use strict';

angular.module('templates').config(['$stateProvider', function ($stateProvider) {
	$stateProvider.state('templates', {
		url: '/templates',
		params: {
			templateId: '',
			templateType: '',
			category: 'templates'
		},
		views: {
			'aside': {templateUrl: 'modules/core/views/todo.client.view.html'},
			'': {
				/** @ngInject */
				templateUrl: $stateParams => {
					switch ($stateParams.templateType) {
						case 'eventTemplates':
							return 'modules/templates/views/templates-events.client.view.html';
						case 'taskTemplates':
						default:
							return 'modules/templates/views/templates-tasks.client.view.html';
					}
				},
				controller: 'TemplatesController',
				controllerAs: 'templates'
			}
		},
		resolve: {
			/** @ngInject */
			template: ($stateParams, TemplatesService, Authentication) => {
				if (!$stateParams.templateId || !$stateParams.templateType) {
					return TemplatesService.getLastUsed('taskTemplates', Authentication.user);
				}

				return TemplatesService.getById(Authentication.user, $stateParams.templateId, $stateParams.templateType);
			}
		}
	});
}]);
