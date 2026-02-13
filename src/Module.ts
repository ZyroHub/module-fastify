import { Core, BaseModule, Module } from '@zyrohub/core';
import {
	DefinedController,
	HttpResponse,
	ROUTER_CONTROLLERS_STORAGE_KEY,
	RouteSchemaContext
} from '@zyrohub/module-router';
import { Ansi, Terminal, Validator } from '@zyrohub/utilities';
import fastify, {
	FastifyBaseLogger,
	FastifyHttpOptions,
	FastifyInstance,
	FastifyListenOptions,
	RawServerDefault
} from 'fastify';

export interface FastifyModuleOptions {
	port?: number | string;
	host?: string;

	rawOptions?: FastifyHttpOptions<RawServerDefault, FastifyBaseLogger> | undefined;
	rawListenOptions?: FastifyListenOptions;

	onSetup?(server: FastifyInstance, core: Core): void;
}

@Module()
export class FastifyModule extends BaseModule {
	static options: FastifyModuleOptions;

	server?: FastifyInstance;

	port: number = 3000;

	constructor() {
		super();
	}

	private async handleLoadController(controller: DefinedController) {
		if (!this.core || !this.server) return;

		const core = this.core;

		const controllerInstance = core.instantiate(controller.data.constructor);

		const prefix = controller.data.path || '/';
		const controllerMiddlewares = controller.data.middlewares || [];

		for (const route of controller.routes) {
			const rawUrl = `${prefix}${route.path}`.replace(/\/+/g, '/');
			const url = rawUrl.length > 1 && rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;

			const method = route.method.toLowerCase() as
				| 'get'
				| 'post'
				| 'put'
				| 'delete'
				| 'patch'
				| 'options'
				| 'head';

			this.server[method](url, async (request, reply) => {
				const context: RouteSchemaContext = {
					request,
					response: reply,
					state: {},
					body: request.body,
					query: request.query,
					params: request.params
				};

				if (route.schema?.validators.body) {
					const result = await Validator.validate(route.schema.validators.body, request.body);
					if (!result.success)
						return reply
							.status(400)
							.send(HttpResponse.error(400, 'VALIDATION_ERROR_BODY', result.errors).toObject());

					context.body = result.data;
				}

				if (route.schema?.validators.query) {
					const result = await Validator.validate(route.schema.validators.query, request.query);
					if (!result.success)
						return reply
							.status(400)
							.send(HttpResponse.error(400, 'VALIDATION_ERROR_QUERY', result.errors).toObject());

					context.query = result.data;
				}

				if (route.schema?.validators.params) {
					const result = await Validator.validate(route.schema.validators.params, request.params);
					if (!result.success)
						return reply
							.status(400)
							.send(HttpResponse.error(400, 'VALIDATION_ERROR_PARAMS', result.errors).toObject());

					context.params = result.data;
				}

				const allMiddlewares = [...controllerMiddlewares, ...(route.middlewares || [])];

				for (const middleware of allMiddlewares) {
					const middlewareInstance = core.instantiate(middleware.constructor);

					if (middlewareInstance && typeof middlewareInstance.execute === 'function') {
						let middlewareReturn = await middlewareInstance.execute(context, middleware.options);

						if (middlewareReturn !== undefined) {
							if (middlewareReturn instanceof HttpResponse) {
								return reply.status(middlewareReturn.status).send(middlewareReturn.toObject());
							}

							reply.send(middlewareReturn);
						}
					}
				}

				const routeHandler = (controllerInstance as any)[route.handlerName];
				const routeReturn = await routeHandler.call(controllerInstance, context);

				if (reply.sent) return;

				if (routeReturn instanceof HttpResponse) {
					return reply.status(routeReturn.status).send(routeReturn.toObject());
				}

				return reply.send(routeReturn);
			});
		}
	}

	private async handleLoadControllers() {
		if (!this.core) return;

		const controllers = (this.core.storage.get(ROUTER_CONTROLLERS_STORAGE_KEY) as DefinedController[]) || [];

		if (controllers.length === 0) return;

		for (const controller of controllers) {
			await this.handleLoadController(controller);
		}

		Terminal.info('FASTIFY', `Loaded ${Ansi.green(controllers.length)} controller(s) into Fastify module.`);
	}

	private async handleAddHandlers() {
		if (!this.server) return;

		this.server.setNotFoundHandler((request, reply) => {
			reply.status(404).send({
				success: false,
				status: 404,
				code: 'NOT_FOUND',
				data: {
					message: 'The requested resource was not found.'
				}
			});
		});

		this.server.setErrorHandler((error, request, reply) => {
			if (error instanceof HttpResponse) return reply.status(error.status).send(error.toObject());

			reply.status(500).send({
				success: false,
				status: 500,
				code: 'INTERNAL_SERVER_ERROR',
				data: {
					message: 'An internal server error occurred.'
				}
			});
		});
	}

	async init(data: { core: Core; options: FastifyModuleOptions }) {
		this.server = fastify({
			logger: false,
			...data.options.rawOptions
		});

		if (data.options.onSetup) data.options.onSetup(this.server, data.core);

		const parsedPort = typeof data.options.port === 'string' ? parseInt(data.options.port, 10) : data.options.port;
		this.port = parsedPort || 3000;

		await this.handleLoadControllers();
		await this.handleAddHandlers();

		this.server.listen({
			port: this.port,
			host: data.options.host,

			...data.options.rawListenOptions
		});

		Terminal.info('FASTIFY', `Server is listening on port: ${Ansi.green(this.port.toString())}`);
	}
}

export default { FastifyModule };
