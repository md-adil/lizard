import * as React from "react";
import Tab, { OnClose } from "../ui/Tab";

import { IContentState } from "../store/content/types";

interface IProps {
    content: IContentState;
    onTabChange: (key: string) => void;
    onClose: OnClose;
}

export default ({ content, onTabChange, onClose }: IProps) => (
    <section className="content">
        <Tab active={content.active} onChange={onTabChange} onClose={onClose}>
            {content.data.map(c => (
                <Tab.Pane
                    key={c.key || c.title}
                    title={c.title}
                    closable={c.closable}
                >
                    {c.content}
                </Tab.Pane>
            ))}
        </Tab>
    </section>
);
