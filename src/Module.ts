import { Core, BaseModule, Module } from '@zyrohub/core';

export interface FastifyModuleOptions {}

@Module()
export class FastifyModule extends BaseModule {
	static options: FastifyModuleOptions;

	constructor() {
		super();
	}

	async init(data: { core: Core; options: FastifyModuleOptions }) {}
}

export default { FastifyModule };
