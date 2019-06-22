const webpack = require('webpack'),
	path = require('path'),
	HTMLWebpackPlugin = require('html-webpack-plugin'),
	TSLintPlugin = require('tslint-webpack-plugin');

module.exports = {
	watch: true,
	mode: 'development',
	target: 'electron-renderer',
	devtool: 'inline-source-map',
	resolve: {  extensions: ['.ts', '.tsx', '.js'] },
	entry: {
		main: './app/index.ts'
	},
	module: {
		rules: [
			{ test: /\.tsx?$/, use: [ 'awesome-typescript-loader' ], exclude: /node_modules/ },
			{ test: /\.scss$/, use: [ 'style-loader', 'css-loader', 'sass-loader' ] }
		]
	},
	output: {
		path: path.resolve('dist'),
		filename: '[name].js',
		publicPath: '/dist/'
	},

	plugins: [
		new HTMLWebpackPlugin({
			title: 'Lizard'
		}),
		new TSLintPlugin({
            files: [path.resolve(__dirname, '../app/**/*.ts')]
        })
	],

	devServer: {
		hot: true,
		historyApiFallback: true,
		contentBase: path.join(__dirname, 'dist'),
		compress: true,
		port: 8888
	}
}
