<div align="center">
    <img src="https://i.imgur.com/KVVR2dM.png">
</div>

## ZyroHub - Fastify Module

This is the Fastify module for ZyroHub ecosystem. It allows you to easily create a Fastify server and integrate it with [`@zyrohub/module-router`](https://www.npmjs.com/package/@zyrohub/module-router).

## Table of Contents

- [ZyroHub - Fastify Module](#zyrohub---fastify-module)
- [Table of Contents](#table-of-contents)
- [Getting Started](#getting-started)
	- [Required Dependencies](#required-dependencies)
	- [Using Module](#using-module)
- [Declaring Request and Response types](#declaring-request-and-response-types)

## Getting Started

To install the fastify module, use one of the following package managers:

[NPM Repository](https://www.npmjs.com/package/@zyrohub/module-fastify)

```bash
# npm
npm install @zyrohub/module-fastify
# yarn
yarn add @zyrohub/module-fastify
# pnpm
pnpm add @zyrohub/module-fastify
# bun
bun add @zyrohub/module-fastify
```

### Required Dependencies

You also need to install `fastify`, [`@zyrohub/module-router`](https://www.npmjs.com/package/@zyrohub/module-router) and [`@zyrohub/core`](https://www.npmjs.com/package/@zyrohub/core) dependencies:

```bash
# npm
npm install fastify @zyrohub/module-router @zyrohub/core

# yarn
yarn add fastify @zyrohub/module-router @zyrohub/core

# pnpm
pnpm add fastify @zyrohub/module-router @zyrohub/core

# bun
bun add fastify @zyrohub/module-router @zyrohub/core
```

### Using Module

```typescript
import { Core } from '@zyrohub/core';
import { FastifyModule } from '@zyrohub/module-fastify';
import { RouterModule } from '@zyrohub/module-router';

const core = new Core({
	modules: [
		RouterModule.mount({
			// RouterModule options here (see @zyrohub/module-router documentation)
		}),
		FastifyModule.mount({
			port: 3000,
			host: 'localhost', // optional

			rawOptions: {
				// Fastify server options here (see https://www.fastify.io/docs/latest/Reference/Server/)
			},
			rawListenOptions: {
				// Fastify listen options here (see https://www.fastify.io/docs/latest/Reference/Server/#listen)
			},

			onSetup(server, core) {
				// called once the Fastify server is being set up and before registering routes
			}
		})
	]
});

core.init();
```

## Declaring Request and Response types

```typescript
// e.g., src/types/router.d.ts
import '@zyrohub/module-router';
import { FastifyReply, FastifyRequest } from 'fastify';

declare module '@zyrohub/module-router' {
	interface RouterGlobalInputs {
		request: FastifyRequest;
		response: FastifyReply;

		state: Record<string, any>; // optional, for storing custom state in the context (you can define a custom type here if you want)
	}
}
```
