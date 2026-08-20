import fastifyMultipart, { FastifyMultipartOptions } from '@fastify/multipart';
import { Core, BaseModule, Module } from '@zyrohub/core';
import {
	DefinedController,
	HttpResponse,
	MountedRoute,
	ROUTER_CONTROLLERS_STORAGE_KEY,
	RouteSchemaContext,
	RouteSchemaContextFile
} from '@zyrohub/module-router';
import { Ansi, Terminal, Validator } from '@zyrohub/utilities';
import fastify, {
	FastifyBaseLogger,
	FastifyHttpOptions,
	FastifyInstance,
	FastifyListenOptions,
	FastifyRequest,
	RawServerDefault
} from 'fastify';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

import { MaxSizeLimitStream } from './components/MaxSizeLimitStream.js';

export interface FastifyModuleMultipartOptions {
	active?: boolean;
	options?: FastifyMultipartOptions;
}

export interface FastifyModuleOptions {
	port?: number | string;
	host?: string;

	rawOptions?: FastifyHttpOptions<RawServerDefault, FastifyBaseLogger> | undefined;
	rawListenOptions?: FastifyListenOptions;

	multipart?: FastifyModuleMultipartOptions;

	onSetup?(server: FastifyInstance, core: Core): void | Promise<void>;
}

@Module()
export class FastifyModule extends BaseModule {
	static options: FastifyModuleOptions;

	server?: FastifyInstance;

	port: number = 3000;

	constructor() {
		super();
	}

	private createMultipartProcessor(request: FastifyRequest, route: MountedRoute, context: RouteSchemaContext) {
		return async (fileCallback: (file: RouteSchemaContextFile) => any) => {
			let bodyFields: Record<string, any> = {};
			const contextFiles: RouteSchemaContextFile[] = [];

			const filesRules = route.schema?.validators.files;
			const fieldCounts: Record<string, number> = {};

			const maxFileSize = filesRules?.options?.maxFileSize;
			const maxFileCount = filesRules?.options?.maxFiles;

			const parts = request.parts({
				limits: {
					fileSize: maxFileSize
				}
			});

			try {
				for await (const part of parts) {
					if (part.type === 'file') {
						const fieldRule = filesRules?.fields?.find(rule => rule.name === part.fieldname);
						const allowedMimes = fieldRule?.mimeTypes ?? filesRules?.options?.mimeTypes;

						const drainCurrentPart = async () => {
							part.file.resume();
						};

						if (allowedMimes && !allowedMimes.includes(part.mimetype)) {
							await drainCurrentPart();
							throw HttpResponse.error(400, 'INVALID_MIME_TYPE', {
								field: part.fieldname,
								allowedMimes
							});
						}

						if (maxFileCount !== undefined && contextFiles.length >= maxFileCount) {
							await drainCurrentPart();
							throw HttpResponse.error(400, 'MAXIMUM_FILES_EXCEEDED', { max: maxFileCount });
						}

						if (!fieldRule && !filesRules?.options?.any) {
							await drainCurrentPart();
							throw HttpResponse.error(400, 'UNKNOWN_FILE_FIELD', { field: part.fieldname });
						}

						const currentFieldCount = (fieldCounts[part.fieldname] || 0) + 1;
						if (fieldRule?.maxCount !== undefined && currentFieldCount > fieldRule.maxCount) {
							await drainCurrentPart();
							throw HttpResponse.error(400, 'MAXIMUM_FIELD_FILES_EXCEEDED', {
								field: part.fieldname,
								max: fieldRule.maxCount
							});
						}

						fieldCounts[part.fieldname] = currentFieldCount;

						const effectiveMaxSize = fieldRule?.maxSize ?? maxFileSize;

						const protectedStream =
							effectiveMaxSize !== undefined
								? part.file.pipe(new MaxSizeLimitStream(effectiveMaxSize, part.fieldname))
								: part.file;

						const fileItem: RouteSchemaContextFile = {
							fieldName: part.fieldname,
							fileName: part.filename,
							mimeType: part.mimetype,
							encoding: part.encoding,

							stream: protectedStream,

							async toBuffer(): Promise<Buffer> {
								if (part.file.destroyed || part.file.readableEnded)
									throw new Error(`File "${part.filename}" previously consumed.`);

								const chunks: Buffer[] = [];

								try {
									for await (const chunk of protectedStream) {
										chunks.push(Buffer.from(chunk));
									}
								} catch (err: any) {
									if (err.message?.startsWith('EXCEEDED_MAXIMUM_FILE_SIZE')) {
										throw HttpResponse.error(400, 'EXCEEDED_MAXIMUM_FILE_SIZE', {
											field: part.fieldname,
											max: effectiveMaxSize
										});
									}
									throw err;
								}

								return Buffer.concat(chunks);
							},

							async saveTo(destinationPath: string): Promise<void> {
								try {
									await pipeline(protectedStream, createWriteStream(destinationPath));
								} catch (err: any) {
									await fs.unlink(destinationPath).catch(() => { });

									if (err.message?.startsWith('EXCEEDED_MAXIMUM_FILE_SIZE')) {
										throw HttpResponse.error(400, 'EXCEEDED_MAXIMUM_FILE_SIZE', {
											field: part.fieldname,
											max: effectiveMaxSize
										});
									}

									throw err;
								}
							}
						};

						await fileCallback(fileItem);

						if (!part.file.readableEnded && !part.file.destroyed) {
							part.file.resume();
						}

						contextFiles.push(fileItem);
					} else if (part.type === 'field') {
						bodyFields[part.fieldname] = part.value;
					}
				}
			} catch (err: any) {
				if (err.code === 'FST_REQ_FILE_TOO_LARGE')
					throw HttpResponse.error(400, 'EXCEEDED_MAXIMUM_FILE_SIZE', {
						max: maxFileSize
					});

				if (err instanceof HttpResponse) throw err;

				throw HttpResponse.error(500, 'MULTIPART_PROCESSING_ERROR');
			}

			const fieldsWithMin = filesRules?.fields?.filter(rule => rule.minCount) || [];

			for (const rule of fieldsWithMin) {
				const count = fieldCounts[rule.name] || 0;

				if (count < rule.minCount!) {
					throw HttpResponse.error(400, 'MISSING_FILES', {
						field: rule.name,
						min: rule.minCount
					});
				}
			}

			if (route.schema?.validators.body) {
				const result = await Validator.validate(route.schema.validators.body, bodyFields);
				if (!result.success) throw HttpResponse.error(400, 'VALIDATION_ERROR_BODY', result.errors);

				bodyFields = result.data;
			}

			context.body = bodyFields;

			return { body: bodyFields, files: contextFiles };
		};
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
					params: request.params,

					processMultipart: async () => ({ body: undefined, files: [] })
				};

				context.processMultipart = this.createMultipartProcessor(request, route, context);

				const contentType = request.headers['content-type']?.split(';')[0].trim();
				const isMultipart = request.isMultipart();

				if (route.schema?.consumes?.length) {
					const isAllowed = route.schema.consumes.some(
						allowed => contentType === allowed || (allowed === 'multipart/form-data' && isMultipart)
					);

					if (!isAllowed)
						return reply.status(415).send(
							HttpResponse.error(415, 'UNSUPPORTED_MEDIA_TYPE', {
								allowedTypes: route.schema.consumes
							}).toObject()
						);
				}

				if (!isMultipart && route.schema?.validators.body) {
					const result = await Validator.validate(route.schema.validators.body, context.body);
					if (!result.success)
						return reply
							.status(400)
							.send(HttpResponse.error(400, 'VALIDATION_ERROR_BODY', result.errors).toObject());

					context.body = result.data;
				}

				if (route.schema?.validators.query) {
					const result = await Validator.validate(route.schema.validators.query, context.query);
					if (!result.success)
						return reply
							.status(400)
							.send(HttpResponse.error(400, 'VALIDATION_ERROR_QUERY', result.errors).toObject());

					context.query = result.data;
				}

				if (route.schema?.validators.params) {
					const result = await Validator.validate(route.schema.validators.params, context.params);
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

				if (routeReturn !== undefined) return reply.send(routeReturn);
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

			console.error(error);

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

		const multipartOptions: FastifyModuleMultipartOptions = {
			active: true,
			...data.options.multipart
		};

		if (multipartOptions.active)
			this.server.register(fastifyMultipart, {
				...multipartOptions.options
			});

		if (data.options.onSetup) await data.options.onSetup(this.server, data.core);

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
