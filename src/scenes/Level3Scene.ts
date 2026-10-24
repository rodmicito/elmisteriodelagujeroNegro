import Phaser from 'phaser';
import { AudioService } from '../audio/AudioService';
import { StorageService } from '../utils/StorageService';

interface Question {
  text: string;
  options: string[];
  correct: number;
  explanation: string;
}

export class Level3Scene extends Phaser.Scene {
  private starPoints: { id: number; x: number; y: number }[] = [];
  private requiredConnections: [number, number][] = [];
  private currentConnections: Set<string> = new Set();
  
  private selectedStarId: number | null = null;
  private drawingLine!: Phaser.GameObjects.Graphics;
  private fixedLines!: Phaser.GameObjects.Graphics;
  private pointerPos = { x: 0, y: 0 };
  
  private timerText!: Phaser.GameObjects.Text;
  private timeLeft = 45; // 45 seconds to draw
  private countdownTimer!: Phaser.Time.TimerEvent;

  private activeQuestion: Question | null = null;
  private quizActive = false;
  private dialogPanel!: Phaser.GameObjects.Container;
  private currentQuestionIndex = 0;
  
  private quizQuestions: Question[] = [
    {
      text: '¿En qué galaxia se encuentra nuestro Sistema Solar?',
      options: [
        'A) Andrómeda',
        'B) Vía Láctea',
        'C) Triángulo'
      ],
      correct: 1,
      explanation: '¡Correcto! Nuestro sistema solar está ubicado en uno de los brazos espirales de la Vía Láctea, el Brazo de Orión.'
    },
    {
      text: '¿Qué es una constelación?',
      options: [
        'A) Una agrupación convencional de estrellas que forma una figura.',
        'B) Un grupo de planetas orbitando un sol.',
        'C) Una nube de gas intergaláctico.'
      ],
      correct: 0,
      explanation: '¡Excelente! Las constelaciones son agrupaciones imaginarias de estrellas inventadas por antiguas civilizaciones para mapear el cielo nocturno.'
    }
  ];

  constructor() {
    super('Level3Scene');
  }

  create(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x0a0f2c, 1); // Deep blue space
    bg.fillRect(0, 0, width, height);

    for (let i = 0; i < 120; i++) {
      this.add.circle(
        Phaser.Math.Between(0, width), 
        Phaser.Math.Between(0, height), 
        Phaser.Math.FloatBetween(0.5, 2), 
        0xffffff, 
        Phaser.Math.FloatBetween(0.1, 0.5)
      );
    }

    // UI
    this.add.text(20, height - 40, 'Controles: Haz CLIC en una estrella y ARRASTRA a otra para conectarlas. ¡Revela la constelación oculta!', {
      font: '14px "Outfit", "Inter", sans-serif',
      color: '#b3e5fc'
    });

    this.timerText = this.add.text(20, 20, `Tiempo: ${this.timeLeft}s`, {
      font: 'bold 24px "Outfit", "Inter", sans-serif',
      color: '#ffffff'
    });

    // Exit Button
    const exitBtn = this.add.text(width - 20, 20, '✖ SALIR', {
      font: 'bold 16px "Outfit", "Inter", sans-serif',
      color: '#ff5555',
      backgroundColor: '#220000',
      padding: { x: 10, y: 5 }
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

    exitBtn.on('pointerover', () => exitBtn.setColor('#ffffff'));
    exitBtn.on('pointerout', () => exitBtn.setColor('#ff5555'));
    exitBtn.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.cameras.main.fadeOut(400, 10, 5, 27);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('MainMenuScene');
      });
    });

    // Drawing lines layer
    this.fixedLines = this.add.graphics();
    this.drawingLine = this.add.graphics();

    // Setup Constellation Points (Cassiopeia shape 'W')
    const offsetX = width / 2 - 200;
    const offsetY = height / 2 - 100;
    this.starPoints = [
      { id: 1, x: offsetX + 0, y: offsetY + 50 },
      { id: 2, x: offsetX + 80, y: offsetY + 150 },
      { id: 3, x: offsetX + 180, y: offsetY + 60 },
      { id: 4, x: offsetX + 280, y: offsetY + 120 },
      { id: 5, x: offsetX + 400, y: offsetY + 0 }
    ];

    this.requiredConnections = [
      [1, 2], [2, 3], [3, 4], [4, 5]
    ];
    this.currentConnections.clear();

    // Create interactive stars
    this.starPoints.forEach(sp => {
      const starGlow = this.add.circle(sp.x, sp.y, 25, 0x4fc3f7, 0.1);
      const starCore = this.add.circle(sp.x, sp.y, 8, 0xffffff, 1);
      
      this.tweens.add({
        targets: starGlow,
        scale: 1.5,
        alpha: 0.2,
        duration: 1500,
        yoyo: true,
        repeat: -1
      });

      const zone = this.add.zone(sp.x, sp.y, 40, 40).setInteractive({ useHandCursor: true });
      
      zone.on('pointerdown', () => {
        if (this.quizActive) return;
        AudioService.playSFX('click');
        this.selectedStarId = sp.id;
      });

      zone.on('pointerover', () => {
        if (!this.quizActive) starCore.setFillStyle(0xffc107);
      });

      zone.on('pointerout', () => {
        starCore.setFillStyle(0xffffff);
      });
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.quizActive) return;
      this.pointerPos.x = pointer.x;
      this.pointerPos.y = pointer.y;
    });

    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      if (this.quizActive) return;
      
      if (this.selectedStarId !== null) {
        // find if pointer is over any star zone
        const droppedOnStar = this.starPoints.find(sp => {
           const dist = Phaser.Math.Distance.Between(pointer.x, pointer.y, sp.x, sp.y);
           return dist <= 40;
        });

        if (droppedOnStar && droppedOnStar.id !== this.selectedStarId) {
          this.attemptConnection(this.selectedStarId, droppedOnStar.id);
        }
      }

      this.selectedStarId = null;
      this.drawingLine.clear();
    });

    // Countdown
    this.countdownTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.quizActive) {
          this.timeLeft--;
          this.timerText.setText(`Tiempo: ${this.timeLeft}s`);
          if (this.timeLeft <= 0) {
            this.handleTimeout();
          }
        }
      }
    });

    // Atajo: P pasa el nivel al instante (para pruebas)
    this.input.keyboard?.addKey('P').on('down', () => {
      if (!this.quizActive) {
        this.quizActive = true;  // detiene el contador de tiempo
        this.completeLevel();
      }
    });

    this.createDialogPanel();
  }

  update(): void {
    if (this.quizActive) {
      this.drawingLine.clear();
      return;
    }

    if (this.selectedStarId !== null) {
      const startStar = this.starPoints.find(s => s.id === this.selectedStarId);
      if (startStar) {
        this.drawingLine.clear();
        this.drawingLine.lineStyle(3, 0xffa500, 0.8);
        this.drawingLine.beginPath();
        this.drawingLine.moveTo(startStar.x, startStar.y);
        this.drawingLine.lineTo(this.pointerPos.x, this.pointerPos.y);
        this.drawingLine.strokePath();
      }
    }
  }

  private getConnectionKey(id1: number, id2: number): string {
    return Math.min(id1, id2) + '-' + Math.max(id1, id2);
  }

  private attemptConnection(id1: number, id2: number): void {
    const key = this.getConnectionKey(id1, id2);
    
    // Check if valid
    const isValid = this.requiredConnections.some(conn => 
      this.getConnectionKey(conn[0], conn[1]) === key
    );

    if (isValid && !this.currentConnections.has(key)) {
      this.currentConnections.add(key);
      AudioService.playSFX('correct');
      this.redrawFixedLines();
      
      if (this.currentConnections.size === this.requiredConnections.length) {
        // Constellation completed!
        this.time.delayedCall(500, () => {
          this.startQuiz();
        });
      }
    } else if (!isValid) {
      // Invalid connection
      AudioService.playSFX('incorrect');
      this.cameras.main.flash(200, 255, 0, 0);
    }
  }

  private redrawFixedLines(): void {
    this.fixedLines.clear();
    this.fixedLines.lineStyle(4, 0x00e676, 1);
    
    this.currentConnections.forEach(key => {
      const [id1, id2] = key.split('-').map(Number);
      const s1 = this.starPoints.find(s => s.id === id1);
      const s2 = this.starPoints.find(s => s.id === id2);
      if (s1 && s2) {
        this.fixedLines.beginPath();
        this.fixedLines.moveTo(s1.x, s1.y);
        this.fixedLines.lineTo(s2.x, s2.y);
        this.fixedLines.strokePath();
      }
    });
  }

  private handleTimeout(): void {
    this.quizActive = true;
    AudioService.playSFX('incorrect');
    this.cameras.main.flash(500, 255, 0, 0);
    this.resetLevel();
  }

  private resetLevel(): void {
    this.currentConnections.clear();
    this.redrawFixedLines();
    this.timeLeft = 45;
    this.timerText.setText(`Tiempo: ${this.timeLeft}s`);
    this.quizActive = false;
  }

  private createDialogPanel(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.dialogPanel = this.add.container(0, 0);
    this.dialogPanel.setVisible(false);
    this.dialogPanel.setDepth(100);

    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x000000, 0.7);
    backdrop.fillRect(0, 0, width, height);
    this.dialogPanel.add(backdrop);

    const modalBg = this.add.graphics();
    modalBg.fillStyle(0x130d2d, 0.95);
    modalBg.lineStyle(4, 0xffa500, 1);
    modalBg.fillRoundedRect(width / 2 - 350, height / 2 - 200, 700, 400, 15);
    modalBg.strokeRoundedRect(width / 2 - 350, height / 2 - 200, 700, 400, 15);
    this.dialogPanel.add(modalBg);
  }

  private startQuiz(): void {
    this.currentQuestionIndex = 0;
    this.showQuizQuestion(this.quizQuestions[this.currentQuestionIndex]);
  }

  private showQuizQuestion(q: Question): void {
    this.activeQuestion = q;
    this.quizActive = true;

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    while (this.dialogPanel.list.length > 2) {
      this.dialogPanel.list[2].destroy();
    }

    const qText = this.add.text(width / 2, height / 2 - 160, q.text, {
      fontSize: '36px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 660 }
    }).setOrigin(0.5);
    // Add subtle shadow to stand out more
    qText.setShadow(2, 2, '#000000', 4, true, true);
    this.dialogPanel.add(qText);

    q.options.forEach((opt, idx) => {
      const yPos = height / 2 - 40 + (idx * 60);

      const btnG = this.add.graphics();
      btnG.fillStyle(0x281c4e, 1);
      btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
      this.dialogPanel.add(btnG);

      const btnT = this.add.text(width / 2 - 260, yPos, opt, {
        fontSize: '17px',
        fontFamily: 'Outfit, sans-serif',
        fontStyle: 'bold',
        color: '#ffc107'
      }).setOrigin(0, 0.5);
      this.dialogPanel.add(btnT);

      const btnZone = this.add.zone(width / 2, yPos, 560, 44).setInteractive({ useHandCursor: true });
      this.dialogPanel.add(btnZone);

      btnZone.on('pointerover', () => {
        btnG.clear();
        btnG.fillStyle(0x3e2c7a, 1);
        btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
      });

      btnZone.on('pointerout', () => {
        btnG.clear();
        btnG.fillStyle(0x281c4e, 1);
        btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
      });

      btnZone.on('pointerdown', () => {
        this.selectAnswer(idx);
      });
    });

    this.dialogPanel.setVisible(true);
  }

  private selectAnswer(index: number): void {
    if (!this.activeQuestion) return;

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const isCorrect = index === this.activeQuestion.correct;

    AudioService.playSFX(isCorrect ? 'correct' : 'incorrect');

    while (this.dialogPanel.list.length > 2) {
      this.dialogPanel.list[2].destroy();
    }

    const feedbackText = this.add.text(width / 2, height / 2 - 60, isCorrect ? '¡RESPUESTA CORRECTA!' : 'RESPUESTA INCORRECTA', {
      font: 'bold 32px "Outfit", sans-serif',
      color: isCorrect ? '#00e676' : '#ff1744',
      align: 'center'
    }).setOrigin(0.5);
    this.dialogPanel.add(feedbackText);

    const explanationText = this.add.text(width / 2, height / 2 + 10, isCorrect ? this.activeQuestion.explanation : 'Incorrecto. Recuerda que vivimos en la Vía Láctea y las constelaciones son figuras trazadas por estrellas.', {
      font: '20px "Outfit", sans-serif',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }).setOrigin(0.5);
    this.dialogPanel.add(explanationText);

    const btnContinue = this.add.graphics();
    btnContinue.fillStyle(isCorrect ? 0x00e676 : 0xff1744, 1);
    btnContinue.fillRoundedRect(width / 2 - 100, height / 2 + 100, 200, 44, 8);
    this.dialogPanel.add(btnContinue);

    const btnText = this.add.text(width / 2, height / 2 + 122, isCorrect ? 'CONTINUAR' : 'REINTENTAR', {
      font: 'bold 18px "Outfit", sans-serif',
      color: '#ffffff'
    }).setOrigin(0.5);
    this.dialogPanel.add(btnText);

    const continueZone = this.add.zone(width / 2, height / 2 + 122, 200, 44).setInteractive({ useHandCursor: true });
    this.dialogPanel.add(continueZone);

    continueZone.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.dialogPanel.setVisible(false);

      if (!isCorrect) {
        this.resetLevel();
      } else {
        this.currentQuestionIndex++;
        if (this.currentQuestionIndex < this.quizQuestions.length) {
          this.showQuizQuestion(this.quizQuestions[this.currentQuestionIndex]);
        } else {
          this.completeLevel();
        }
      }
    });
  }

  private completeLevel(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    while (this.dialogPanel.list.length > 2) {
      this.dialogPanel.list[2].destroy();
    }

    StorageService.setCurrentLevel(4); // Max level achieved?
    StorageService.unlockBadge('astronomo'); // Astronomer badge
    AudioService.playSFX('achievement');

    const winTitle = this.add.text(width / 2, height / 2 - 100, '¡JUEGO COMPLETADO!', {
      font: 'bold 36px "Outfit", sans-serif',
      color: '#ffc107',
      align: 'center'
    }).setOrigin(0.5);
    this.dialogPanel.add(winTitle);

    const winDesc = this.add.text(width / 2, height / 2 - 10, 'Has mapeado el universo y demostrado ser un verdadero explorador estelar.\n\n¡Ganaste la insignia "Astrónomo Mayor"!', {
      font: '20px "Outfit", sans-serif',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }).setOrigin(0.5);
    this.dialogPanel.add(winDesc);

    const btnMenu = this.add.graphics();
    btnMenu.fillStyle(0x00e5ff, 1);
    btnMenu.fillRoundedRect(width / 2 - 120, height / 2 + 100, 240, 48, 8);
    this.dialogPanel.add(btnMenu);

    const btnText = this.add.text(width / 2, height / 2 + 124, 'SIGUIENTE NIVEL', {
      font: 'bold 16px "Outfit", sans-serif',
      color: '#130d2d'
    }).setOrigin(0.5);
    this.dialogPanel.add(btnText);

    const menuZone = this.add.zone(width / 2, height / 2 + 124, 240, 48).setInteractive({ useHandCursor: true });
    this.dialogPanel.add(menuZone);

    menuZone.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.dialogPanel.setVisible(false);
      this.cameras.main.fadeOut(400, 10, 5, 27);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('Level4Scene');
      });
    });

    this.dialogPanel.setVisible(true);
  }
}
