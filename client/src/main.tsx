import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { captureRef } from './lib/invite';
import './styles/app.css';

/*
 * 邀请码必须在 React 挂载**之前**落盘。
 * 子组件的 effect 先于父组件执行，等 App 的 effect 去写就已经晚了一步 ——
 * 落地横幅读到的会是「没有邀请码」（2026-10-23 实测踩过）。
 */
captureRef(window.location.search);

const container = document.getElementById('root');
if (!container) throw new Error('缺少 #root 挂载点');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
