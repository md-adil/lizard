import * as React from "react";
import { connect } from "react-redux";
import CreateConnection from "../components/CreateConnection";

class CreateConnectionContainer extends React.Component {
    public render() {
        return (
            <CreateConnection visible={this.props.connection}/>
        );
    }
}

const mapStateToProps = ({ connection }) => ({ connection });

export default connect(mapStateToProps)(CreateConnectionContainer);
