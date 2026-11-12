"""Run the complete app on ONE local port; optionally open the browser."""
import os,threading,webbrowser
import uvicorn

if __name__ == '__main__':
    port=int(os.environ.get('RELAY_PORT','8766'))
    print('\n  RELAY FUSION v12.0 · five-policy shared-input arena / legacy three twins')
    print(f'  Interface: http://127.0.0.1:{port}/')
    print(f'  Old 3 twins: http://127.0.0.1:{port}/v11')
    print(f'  Evidence:   http://127.0.0.1:{port}/v11/evidence')
    print(f'  API docs:  http://127.0.0.1:{port}/docs')
    print(f'  MCP:       http://127.0.0.1:{port}/mcp (Streamable HTTP)')
    print('  SYNTHETIC SHADOW MODE / ONE SERVER-OWNED CLOCK + THREE TWIN VIEWS · NATIVE WebGL2 GROUND + LIVE MATH VISUALS + MULTI-ROUTE GLOBE + BOUNDED V5 MATH · OAG-compatible mock, NO real airline commands\n')
    if os.environ.get('RELAY_NO_BROWSER') != '1':
        threading.Timer(3,lambda:webbrowser.open(f'http://127.0.0.1:{port}/')).start()
    uvicorn.run('fusion_app:app',host='127.0.0.1',port=port,log_level='warning',reload=False)
