"""艾宾浩斯背单词应用 · 启动脚本"""
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8089,
        reload=True,
        reload_dirs=["app", "web"],
    )
