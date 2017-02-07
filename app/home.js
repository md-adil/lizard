const tabCreator = using('render/tabs');
module.exports = function(connectRenderer) {
	$('#btn-add-connection').click(e => {
		e.preventDefault();
		$('#modal-add-connection').modal('show');
	});
	
	$('#form-add-connection').submit(e => {
		e.preventDefault();
		var conf = formToObj($(e.target).serializeArray());
		connectRenderer.add(conf);
		$('#modal-add-connection').modal('hide');
	});

	let creator = tabCreator($('#app-body'));
	$('#btn-manage-users').click(function() {
		let tab = creator.add('Add new users', 'user form', 'manage-users');
	});
};

function formToObj(arr) {
	var conf = {};
	arr.forEach(d => {
		conf[d.name] = d.value;
	});
	return conf;
}
$('a').dblclick(function() {
	return false;
});