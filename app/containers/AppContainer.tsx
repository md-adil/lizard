import * as React from "react";
import App from "../components/App";
import { connect } from "react-redux";
import * as connectionAction from "../store/connection/action";

interface IProps {
    dispatch: any;
}

class AppContainer extends React.Component<IProps> {
    public handleAddConnection = () => {
        this.props.dispatch(connectionAction.creating(true));
    };

    public render() {
        return <App onAddConnection={this.handleAddConnection} />;
    }
}

const mapDispatch = (dispatch: any) => ({ dispatch });

export default connect(
    null,
    mapDispatch
)(AppContainer);
