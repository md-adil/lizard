import * as React from "react";
import "./tab.scss";
const { map } = React.Children;

interface IPropsPane {
    key: string;
    title: string;
    children: React.ReactNode;
}

const Pane = (props: IPropsPane) => {
    return null;
};

interface IProps {
    active: string;
    children: React.ReactNode;
    onChange: (key: string, props: IPropsPane) => void;
}

class Tab extends React.Component<IProps> {
    public static Pane = Pane;

    public renderContent = (pane: any) => {
        if (this.props.active !== pane.key) {
            return null;
        }
        return (
            <div className="tab-content">{pane.props.children}</div>
        );
    }

    public handleChange(pane: any, e: React.SyntheticEvent) {
        this.props.onChange(pane.key, pane.props);
    }

    public renderNav = (pane: any) => {
        return (
            <span className="ui-tabs-nav-btn" onClick={this.handleChange.bind(this, pane)}>
                {pane.props.title}<a>&times;</a>
            </span>
        );
    }

    public render() {
        return (
            <div className="ui-tabs">
                <nav className="ui-tabs-nav">{map(this.props.children, this.renderNav)}</nav>
                {map(this.props.children, this.renderContent)}
            </div>
        );
    }
}

export default Tab;
