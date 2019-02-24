import * as React from 'react';
import * as ReactDOM from 'react-dom';
import AppContainer from './containers/AppContainer';

const app = document.createElement('div');

document.body.appendChild(app);

ReactDOM.render(<AppContainer />, app);
