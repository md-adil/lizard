import classnames from "classnames";
import * as React from "react";
import "./button.scss";
import Icon from "./Icon";

interface IProps {
    children: React.ReactNode;
    onClick ?: () => void;
    isLoading: boolean;
}

class Button extends React.Component<IProps> {
    public static defaultProps = {
        isLoading: false,
    };

    public render() {
        const { children, isLoading, onClick, ...props } = this.props;
        return (
            <button
                onClick={isLoading ? undefined : onClick}
                className={classnames("ui-btn", {"is-loading": isLoading})}
                {...props}
            >
                {children}
            </button>
        );
    }
}

export default Button;
