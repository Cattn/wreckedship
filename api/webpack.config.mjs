import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
	entry: './src/server.ts',
	target: 'node',
	mode: 'production',
	module: {
		rules: [
			{
				test: /\.tsx?$/,
				use: 'ts-loader',
				exclude: /node_modules/
			}
		]
	},
	resolve: {
		extensions: ['.tsx', '.ts', '.js']
	},
	output: {
		filename: 'server.cjs',
		path: path.resolve(__dirname, 'dist'),
		clean: true
	},
	externals: {
		// Don't bundle node_modules for server
		express: 'commonjs express',
		'express-fileupload': 'commonjs express-fileupload'
	}
};