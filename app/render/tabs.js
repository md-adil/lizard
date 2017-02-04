class Tab {
	constructor(heading, contents, id, creator) {
		this._creater = creator;
		this._id = id;
		this.make(heading, contents, id);
	}

	make(heading, contents) {
		this._title = 
			$(`<li role="presentation">
				<a href="#${this._id}" aria-controls="${this._id}" role="tab" data-toggle="tab">
				${heading}
				&nbsp;<i class="close">&times;</i>
				</a>
			</li>`);
		this._body = $(`<div role="tabpanel" class="tab-pane" id="${this._id}"></div>`).append(contents);
	}

	getId() {
		return this._id;
	}

	getTitle() {
		return this._title;
	}

	getBody() {
		return this._body;
	}

	show() {
		// this._title.addClass('active').siblings('li').removeClass('active');
		this._title.children('a').children('i').click(e => {
			this.remove();
		});
		this._title.children('a').trigger('click.bs.tab.data-api');
	}

	remove() {
		this._title.remove();
		this._body.remove();
		delete this._creater._tabs[this._id];

		let tabs = this._creater._tabs;
		log('remaing tab: ', tabs);
		let key = Object.keys(tabs).pop();
		if(key) {
			this._creater._tabs[key].show();
		} else {
			$('[href="#home"]').trigger('click.bs.tab.data-api');
		}

		delete this;
	}
}

class TabCreator {
	constructor(parent) {
		log('constructing');
		this._el = parent;
		this._tabs = {};
	}

	add(heading, contents, id) {
		id = this.generateId(id);
		if(this._tabs[id]) {
			this._tabs[id].show();
			return;
		}

		let tab = new Tab(heading, contents, id, this);
		this.append(tab);
		this._tabs[id] = tab;
		tab.show();
		return tab;
	}

	generateId(id) {
		id = id || Math.floor(Math.random() * 10000);
		return 'tab-' + id;
	}

	find(id) {
		id = this.generateId(id);
		return this._tabs[id];
	}

	append(tab) {
		this._el.find('.nav-tabs').append(tab.getTitle());
		this._el.find('.tab-content').append(tab.getBody());
	}
}

module.exports = function(parent) {
	return new TabCreator(parent);
};