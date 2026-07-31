import { Transform, TransformCallback } from 'node:stream';

export class MaxSizeLimitStream extends Transform {
	private downloadedBytes = 0;

	constructor(
		private readonly maxBytes: number,
		private readonly fieldName: string
	) {
		super();
	}

	_transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback) {
		this.downloadedBytes += chunk.length;

		if (this.downloadedBytes > this.maxBytes) {
			const error = new Error(`EXCEEDED_MAXIMUM_FILE_SIZE:${this.fieldName}:${this.maxBytes}`);

			return callback(error);
		}

		callback(null, chunk);
	}
}
