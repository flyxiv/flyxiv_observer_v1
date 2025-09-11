cd ffxiv-auto-recorder
npm install                                                                                                                                                                                                                                                                                                                                                                                         
npm run typecheck                                                                                                                                                                                                                                                                                                                                                                                   
cd ..
Start-Process npm -ArgumentList "-C", "./ffxiv-auto-recorder", "run", "dev:renderer"
Start-Process npm -ArgumentList "-C", "./ffxiv-auto-recorder", "run", "dev:electron"