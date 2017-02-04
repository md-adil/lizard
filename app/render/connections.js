const dbRenderer = using('render/databases');

class Connections {

	constructor(options) {
		this._connections = [];
		this.$connectListEl = $('#connection-list');
	}

	add(cfg) {
		let connections = config('db.connections') || [];
		connections.push(cfg);
		config('db.connections', connections);
		this.render(cfg);
	}

	load() {
		let connections = config('db.connections') || [];
		connections.forEach((config, index) => {
			this.render(config, index);
		});
	}

	render(connection, index) {
		let el = $('<a />');
		el.text(connection.name);
		el.data('connection', connection);
		let removeBtns = $('<a class="close">&times</a>');
		removeBtns.data('index', index);
		this.bindEvents(el, removeBtns);
		$('<li />').append(removeBtns).append(el).appendTo(this.$connectListEl);
	}

	bindEvents(el, remove) {
		el.dblclick(e => {
			e.preventDefault();
			this.showdatabases($(e.target));
		});
		remove.click(e => {
			if(!confirm('Are you sure to delete?')) return;
			this.doDeleteConnection($(e.target).data('index'));
			$(e.target).parent('li').remove();
		});
	}

	doDeleteConnection(index) {
		let connections = config('db.connections') || [];
		connections.splice(index, 1);
		config('db.connections', connections);

	}

	connect() {
		this.showdatabases();
	}

	showdatabases(el) {
		if(el.data('is_connected')) return;
		let renderer = dbRenderer(el.data('connection'));
		renderer.render().then(data => {
			el.attr('id', 'connection-' + data.connection.threadId);
			el.after(data.el);
			el.data('is_connected', true);
		});
	}
}

module.exports = function(options) {
	return new Connections(options);
};
