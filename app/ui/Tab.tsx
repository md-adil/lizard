import * as React from "react";
import "./tab.scss";
const { map } = React.Children;
import classnames from "classnames";

interface IPropsPane {
    key: string;
    title: string;
    children: React.ReactNode;
    closable: boolean;
}

const Pane = (props: IPropsPane) => {
    return null;
};

Pane.defaultProps = {
    closable: true
};

export type OnClose = (key: string, props: IPropsPane) => void;

interface IProps {
    active?: string;
    children: React.ReactNode;
    className?: string;
    onClose?: OnClose;
    onChange: (key: string, props: IPropsPane) => void;
}

class Tab extends React.Component<IProps> {
    public static Pane = Pane;

    public renderContent = (pane: any) => {
        if (!pane) {
            return null;
        }
        if (this.props.active !== pane.key) {
            return null;
        }
        return <div className="tab-content">{pane.props.children}</div>;
    };

    public handleChange(pane: any, e: React.SyntheticEvent) {
        this.props.onChange(pane.key, pane.props);
    }

    public handleClose(pane: any) {
        this.props.onClose && this.props.onClose(pane.key, pane.props);
    }

    public renderNav = (pane: any) => {
        if (!pane) {
            return null;
        }
        const { closable } = pane.props;
        return (
            <span
                className={classnames("ui-tabs-nav-btn", {
                    "is-active": this.props.active === pane.key
                })}
            >
                <span onClick={this.handleChange.bind(this, pane)}>
                    {pane.props.title}
                </span>
                {closable && (
                    <a
                        className="ui ui-tab ui-tab-pane close"
                        onClick={this.handleClose.bind(this, pane)}
                    >
                        &times;
                    </a>
                )}
            </span>
        );
    };

    public render() {
        return (
            <div className={classnames("ui-tabs", this.props.className)}>
                <nav className="ui-tabs-nav">
                    {map(this.props.children, this.renderNav)}
                </nav>
                {map(this.props.children, this.renderContent)}
            </div>
        );
    }
}

export default Tab;
