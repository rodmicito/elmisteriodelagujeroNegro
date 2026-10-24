import Phaser from 'phaser';
import { AudioService } from '../audio/AudioService';
import { StorageService } from '../utils/StorageService';

interface Question {
  text: string;
  options: string[];
  correct: number;
  explanation: string;
}

interface Deflector {
  x: number;
  y: number;
  angle: number; // Current rotation angle in degrees (0, 45, 90, 135, ...)
  targetAngle: number; // Required angle to bounce beam back to center
  graphic: Phaser.GameObjects.Graphics;
  zone: Phaser.GameObjects.Zone;
  isAligned: boolean;
  label: Phaser.GameObjects.Text;
}

export class Level5Scene extends Phaser.Scene {
  private starX = 640;
  private starY = 250;
  private starGraphic!: Phaser.GameObjects.Graphics;
  private starGlow!: Phaser.GameObjects.Arc;
  
  private deflectors: Deflector[] = [];
  private laserGraphic!: Phaser.GameObjects.Graphics;
  private supernovaHappened = false;

  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  private activeQuestion: Question | null = null;
  private quizActive = false;
  private dialogPanel!: Phaser.GameObjects.Container;
  private currentQuestionIndex = 0;

  private quizQuestions: Question[] = [
    {
      text: '¿Qué evento desencadena el nacimiento de un agujero negro estelar?',
      options: [
        'A) El colapso y explosión de supernova de una estrella masiva.',
        'B) La congelación de un planeta rocoso.',
        'C) La pérdida de calor en la atmósfera.'
      ],
      correct: 0,
      explanation: '¡Correcto! Cuando una estrella gigante agota su combustible, colapsa por su propia gravedad y explota como supernova.'
    },
    {
      text: '¿Qué es el Horizonte de Sucesos?',
      options: [
        'A) La frontera invisible de la cual nada, ni la luz, puede escapar.',
        'B) El anillo de meteoritos alrededor de una galaxia.',
        'C) Una superficie sólida de hierro estelar.'
      ],
      correct: 0,
      explanation: '¡Excelente! Es la frontera absoluta. Una vez cruzada, la velocidad de escape requerida supera a la velocidad de la luz.'
    },
    {
      text: '¿Qué ocurre con la gravedad cerca de la Singularidad?',
      options: [
        'A) Se vuelve infinitamente intensa y curva el espacio-tiempo.',
        'B) Se iguala a la gravedad terrestre.',
        'C) Desaparece por completo.'
      ],
      correct: 0,
      explanation: '¡Exacto! En la singularidad la densidad y la gravedad son teóricamente infinitas.'
    }
  ];

  constructor() {
    super('Level5Scene');
  }

  create(): void {
    this.supernovaHappened = false;
    this.quizActive = false;
    this.currentQuestionIndex = 0;
    this.deflectors = [];

    AudioService.playBlackHoleHum();
    this.events.once('shutdown', () => AudioService.stopBlackHoleHum());

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    this.starX = width / 2;
    this.starY = height / 2 - 30;

    // Dark space background with subtle gradient
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x060014, 0x060014, 0x15002b, 0x24003d, 1);
    bg.fillRect(0, 0, width, height);

    // Stars
    for (let i = 0; i < 120; i++) {
      this.add.circle(
        Phaser.Math.Between(0, width),
        Phaser.Math.Between(0, height),
        Phaser.Math.FloatBetween(0.5, 2),
        0xffffff,
        Phaser.Math.FloatBetween(0.15, 0.75)
      );
    }

    // Laser lines graphic layer
    this.laserGraphic = this.add.graphics();

    // Central Unstable Supergiant Star
    this.starGlow = this.add.circle(this.starX, this.starY, 100, 0xff3d00, 0.25);
    this.starGraphic = this.add.graphics();
    this.drawStarCore(0xff5722);

    this.tweens.add({
      targets: this.starGlow,
      scale: 1.3,
      alpha: 0.45,
      duration: 1000,
      yoyo: true,
      repeat: -1
    });

    // UI Header
    this.add.text(width / 2, 20, 'NIVEL 5: DEFLECTORES DE PLASMA GRAVITACIONAL', {
      fontSize: '26px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5, 0);

    this.statusText = this.add.text(20, 60, 'Haces alineados: 0/3', {
      fontSize: '20px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#00e5ff'
    });

    this.hintText = this.add.text(width / 2, height - 35, 'HAZ CLIC O TOCA LAS ESTACIONES DEFLECTORAS PARA GIRAR LOS ESPEJOS Y REBOTAR LOS HACES AL CENTRO.', {
      fontSize: '15px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#ffc107',
      align: 'center'
    }).setOrigin(0.5, 0);

    // Exit Button
    const exitBtn = this.add.text(width - 20, 20, '✖ SALIR', {
      fontSize: '16px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#ff5555',
      backgroundColor: '#220000',
      padding: { x: 10, y: 5 }
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

    exitBtn.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.cameras.main.fadeOut(400, 10, 5, 27);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('MainMenuScene');
      });
    });

    // Setup 3 Deflector Stations around the star
    this.setupDeflectors();
    this.updateLasers();
    this.createDialogPanel();

    // Atajo: P pasa el nivel al instante (para pruebas)
    this.input.keyboard?.addKey('P').on('down', () => {
      if (!this.quizActive) {
        this.quizActive = true;
        this.completeLevel();
      }
    });
  }

  private drawStarCore(color: number): void {
    this.starGraphic.clear();
    this.starGraphic.fillStyle(color, 0.9);
    this.starGraphic.fillCircle(this.starX, this.starY, 65);
    this.starGraphic.fillStyle(0xffffff, 0.9);
    this.starGraphic.fillCircle(this.starX, this.starY, 35);
  }

  private setupDeflectors(): void {
    const configs = [
      { x: this.starX - 280, y: this.starY - 100, initialAngle: 90, targetAngle: 45, labelText: 'ESTACIÓN ALFA' },
      { x: this.starX + 280, y: this.starY - 100, initialAngle: 180, targetAngle: 135, labelText: 'ESTACIÓN BETA' },
      { x: this.starX, y: this.starY + 190, initialAngle: 0, targetAngle: 270, labelText: 'ESTACIÓN GAMMA' }
    ];

    configs.forEach((cfg) => {
      const g = this.add.graphics();
      const zone = this.add.zone(cfg.x, cfg.y, 90, 90).setInteractive({ useHandCursor: true });
      
      const label = this.add.text(cfg.x, cfg.y + 48, cfg.labelText, {
        fontSize: '13px',
        fontFamily: 'Outfit, sans-serif',
        fontStyle: 'bold',
        color: '#80d8ff'
      }).setOrigin(0.5);

      const deflector: Deflector = {
        x: cfg.x,
        y: cfg.y,
        angle: cfg.initialAngle,
        targetAngle: cfg.targetAngle,
        graphic: g,
        zone: zone,
        isAligned: false,
        label: label
      };

      zone.on('pointerdown', () => {
        if (this.supernovaHappened || this.quizActive) return;
        AudioService.playSFX('click');
        deflector.angle = (deflector.angle + 45) % 360;
        this.renderDeflector(deflector);
        this.updateLasers();
      });

      this.renderDeflector(deflector);
      this.deflectors.push(deflector);
    });
  }

  private renderDeflector(d: Deflector): void {
    d.graphic.clear();

    const rad = Phaser.Math.DegToRad(d.angle);
    d.isAligned = (d.angle % 360 === d.targetAngle % 360);

    // Outer Ring
    d.graphic.lineStyle(3, d.isAligned ? 0x00e676 : 0x00e5ff, 0.9);
    d.graphic.fillStyle(0x130d2d, 0.9);
    d.graphic.fillCircle(d.x, d.y, 35);
    d.graphic.strokeCircle(d.x, d.y, 35);

    // Mirror Reflector Line
    const len = 25;
    const dx = Math.cos(rad) * len;
    const dy = Math.sin(rad) * len;

    d.graphic.lineStyle(6, d.isAligned ? 0x00e676 : 0xffc107, 1);
    d.graphic.beginPath();
    d.graphic.moveTo(d.x - dx, d.y - dy);
    d.graphic.lineTo(d.x + dx, d.y + dy);
    d.graphic.strokePath();

    // Center Node
    d.graphic.fillStyle(d.isAligned ? 0x00e676 : 0xffffff, 1);
    d.graphic.fillCircle(d.x, d.y, 6);
  }

  private updateLasers(): void {
    if (this.supernovaHappened) return;

    this.laserGraphic.clear();

    let alignedCount = 0;

    this.deflectors.forEach((d) => {
      // Draw beam from star to deflector
      this.laserGraphic.lineStyle(4, 0xff5722, 0.8);
      this.laserGraphic.beginPath();
      this.laserGraphic.moveTo(this.starX, this.starY);
      this.laserGraphic.lineTo(d.x, d.y);
      this.laserGraphic.strokePath();

      if (d.isAligned) {
        alignedCount++;
        // Draw bright returning focused cyan/gold plasma beam back to star
        this.laserGraphic.lineStyle(6, 0x00e5ff, 0.95);
        this.laserGraphic.beginPath();
        this.laserGraphic.moveTo(d.x, d.y);
        this.laserGraphic.lineTo(this.starX, this.starY);
        this.laserGraphic.strokePath();

        this.laserGraphic.lineStyle(2, 0xffffff, 1);
        this.laserGraphic.beginPath();
        this.laserGraphic.moveTo(d.x, d.y);
        this.laserGraphic.lineTo(this.starX, this.starY);
        this.laserGraphic.strokePath();
      } else {
        // Draw misaligned deflected beam shooting outward into space
        const rad = Phaser.Math.DegToRad(d.angle);
        const shootX = d.x + Math.cos(rad) * 120;
        const shootY = d.y + Math.sin(rad) * 120;

        this.laserGraphic.lineStyle(2, 0xff1744, 0.5);
        this.laserGraphic.beginPath();
        this.laserGraphic.moveTo(d.x, d.y);
        this.laserGraphic.lineTo(shootX, shootY);
        this.laserGraphic.strokePath();
      }
    });

    this.statusText.setText(`Haces alineados: ${alignedCount}/3`);

    if (alignedCount === 3 && !this.supernovaHappened) {
      this.triggerSupernova();
    }
  }

  private triggerSupernova(): void {
    this.supernovaHappened = true;
    AudioService.playSFX('achievement');

    // Explosive camera flash
    this.cameras.main.flash(800, 255, 255, 255);

    // Expand glow into massive Supernova explosion ring
    this.tweens.add({
      targets: this.starGlow,
      scale: 4.5,
      alpha: 0,
      duration: 1000,
      ease: 'Quad.easeOut'
    });

    // Shrink star core
    this.tweens.add({
      targets: this.starGraphic,
      scale: 0.1,
      alpha: 0,
      duration: 1000,
      onComplete: () => {
        this.laserGraphic.clear();

        this.statusText.setText('¡SUPERNOVA DESENCADENADA CON ÉXITO!');
        this.hintText.setText('Preparando cuestionario final...');

        this.time.delayedCall(1000, () => {
          this.startQuiz();
        });
      }
    });
  }

  private createDialogPanel(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.dialogPanel = this.add.container(0, 0);
    this.dialogPanel.setVisible(false);
    this.dialogPanel.setDepth(100);

    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x000000, 0.8);
    backdrop.fillRect(0, 0, width, height);
    this.dialogPanel.add(backdrop);

    const modalBg = this.add.graphics();
    modalBg.fillStyle(0x130d2d, 0.95);
    modalBg.lineStyle(4, 0x7c4dff, 1);
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

    const qText = this.add.text(width / 2, height / 2 - 155, q.text, {
      fontSize: '32px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 660 }
    }).setOrigin(0.5);
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
      fontSize: '32px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: isCorrect ? '#00e676' : '#ff1744',
      align: 'center'
    }).setOrigin(0.5);
    this.dialogPanel.add(feedbackText);

    const explanationText = this.add.text(width / 2, height / 2 + 10, isCorrect ? this.activeQuestion.explanation : 'Incorrecto. La supernova ocurre cuando colapsa una estrella masiva y forma un agujero negro.', {
      fontSize: '20px',
      fontFamily: 'Outfit, sans-serif',
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
      fontSize: '18px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#ffffff'
    }).setOrigin(0.5);
    this.dialogPanel.add(btnText);

    const continueZone = this.add.zone(width / 2, height / 2 + 122, 200, 44).setInteractive({ useHandCursor: true });
    this.dialogPanel.add(continueZone);

    continueZone.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.dialogPanel.setVisible(false);

      if (!isCorrect) {
        this.showQuizQuestion(this.activeQuestion!);
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

    StorageService.setCurrentLevel(1);
    StorageService.unlockBadge('agujero_negro');
    AudioService.playSFX('achievement');

    const winTitle = this.add.text(width / 2, height / 2 - 95, '¡COMPLETATE EL JUEGO!', {
      fontSize: '36px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#ffc107',
      align: 'center'
    }).setOrigin(0.5);
    this.dialogPanel.add(winTitle);

    const desc = this.add.text(width / 2, height / 2 - 5, '¡Felicidades Explorador Espacial!\nHas logrado alinear los rayos estelares, desatar la Supernova y completar toda la misión.\n\nInsignia obtenida: Investigador de Agujeros.', {
      fontSize: '20px',
      fontFamily: 'Outfit, sans-serif',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 620 }
    }).setOrigin(0.5);
    this.dialogPanel.add(desc);

    const btnG = this.add.graphics();
    btnG.fillStyle(0x00e5ff, 1);
    btnG.fillRoundedRect(width / 2 - 120, height / 2 + 105, 240, 48, 8);
    this.dialogPanel.add(btnG);

    const btnText = this.add.text(width / 2, height / 2 + 129, 'VOLVER AL MENÚ', {
      fontSize: '18px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#130d2d'
    }).setOrigin(0.5);
    this.dialogPanel.add(btnText);

    const zone = this.add.zone(width / 2, height / 2 + 129, 240, 48).setInteractive({ useHandCursor: true });
    this.dialogPanel.add(zone);

    zone.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.dialogPanel.setVisible(false);
      this.cameras.main.fadeOut(400, 10, 5, 27);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('MainMenuScene');
      });
    });

    this.dialogPanel.setVisible(true);
  }
}
