import { Core, BaseModule, Module } from '@zyrohub/core';
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
}

@Module()
export class FastifyModule extends BaseModule {
	static options: FastifyModuleOptions;

	server?: FastifyInstance;

	constructor() {
		super();
	}

	async init(data: { core: Core; options: FastifyModuleOptions }) {
		this.server = fastify({
			...data.options.rawOptions
		});

		const parsedPort = typeof data.options.port === 'string' ? parseInt(data.options.port, 10) : data.options.port;

		this.server.listen({
			port: parsedPort || 3000,
			host: data.options.host,

			...data.options.rawListenOptions
		});
	}
}

export default { FastifyModule };
